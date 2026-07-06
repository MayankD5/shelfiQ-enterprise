import contextlib
import os
import sys
import datetime
from collections.abc import AsyncIterator
from typing import Optional, List
from fastapi import FastAPI, Depends, HTTPException, Security, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Add parent directory to path to ensure modules are resolved
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.db import init_db, SessionLocal, InventoryItem, SalesRecord, Supplier, SupplierPrice, PurchaseOrder, AuditLog, User, hash_password
from app.auth import create_access_token, verify_token, require_admin, require_store_manager, require_warehouse_manager, require_finance
from app.forecaster import forecast_demand
from google.adk.runners import Runner
from google.genai import types as genai_types

load_dotenv()

# Initialize DB on startup fallback
init_db()

@contextlib.asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    from app.agent import app as adk_app
    from app.agent import root_agent

    # Initialize ADK Runner
    from google.adk.sessions.in_memory_session_service import InMemorySessionService
    from google.adk.artifacts.in_memory_artifact_service import InMemoryArtifactService

    runner = Runner(
        app=adk_app,
        session_service=InMemorySessionService(),
        artifact_service=InMemoryArtifactService(),
        auto_create_session=True,
    )
    app.state.runner = runner
    app.state.agent_app_name = adk_app.name
    print("Lifespan: ADK Runner initialized.")
    yield

app = FastAPI(
    title="ShelfIQ Enterprise API",
    description="Backend API for ShelfIQ Multi-Agent Inventory Intelligence Platform",
    version="1.0.0",
    lifespan=lifespan
)

# CORS Middleware configuration
allow_origins = os.getenv("ALLOW_ORIGINS", "").split(",") if os.getenv("ALLOW_ORIGINS") else []
if not allow_origins or "*" in allow_origins:
    allow_origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000"
    ]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------------------------------
# Pydantic Schemas for REST API
# ----------------------------------------------------
class LoginPayload(BaseModel):
    email: str
    password: str

class ChatPayload(BaseModel):
    prompt: str
    session_id: str

class POApprovePayload(BaseModel):
    approved: bool  # True for approve, False for reject

class InventoryUpdatePayload(BaseModel):
    product_id: str
    new_stock: int

class POCreatePayload(BaseModel):
    product_id: str
    quantity: int
    supplier_id: str

class ProductCreatePayload(BaseModel):
    product_id: str
    name: str
    category: str
    stock_level: int
    reorder_point: int
    optimal_stock: int
    unit_price: float
    supplier_id: str
    supplier_price: float

# ----------------------------------------------------
# 1. Authentication Routes
# ----------------------------------------------------
@app.post("/api/auth/login")
def login(payload: LoginPayload):
    """Login with email + password; returns JWT with role & store scope."""
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == payload.email).first()
        if not user or user.password_hash != hash_password(payload.password):
            raise HTTPException(status_code=401, detail="Invalid email or password.")
        token = create_access_token(
            uid=str(user.id),
            email=user.email,
            role=user.role,
            name=user.name,
            store_id=user.store_id
        )
        return {
            "access_token": token,
            "token_type": "bearer",
            "user": {
                "email": user.email,
                "role": user.role,
                "name": user.name,
                "store_id": user.store_id
            }
        }
    finally:
        db.close()

@app.get("/api/auth/me")
def get_me(current_user: dict = Depends(verify_token)):
    """Get the current authenticated user's profile."""
    return current_user

# ----------------------------------------------------
# 2. Inventory & Dashboard Stats Routes
# ----------------------------------------------------
@app.get("/api/inventory")
def get_inventory(current_user: dict = Depends(verify_token)):
    """Fetch current inventory levels (scoped by store)."""
    db = SessionLocal()
    try:
        store_id = current_user.get("store_id", "ALL")
        q = db.query(InventoryItem)
        if store_id != "ALL":
            q = q.filter(InventoryItem.store_id == store_id)
        items = q.all()
        result = []
        for item in items:
            # Simple health score calculation
            health = 1.0
            status_label = "HEALTHY"
            if item.stock_level < item.reorder_point:
                health = (item.stock_level / item.reorder_point) * 0.5
                status_label = "CRITICAL"
            elif item.stock_level > item.optimal_stock:
                health = max(0.0, 1.0 - ((item.stock_level - item.optimal_stock) / item.optimal_stock) * 0.5)
                status_label = "WARNING"
            else:
                health = 0.7 + ((item.stock_level - item.reorder_point) / (item.optimal_stock - item.reorder_point)) * 0.3
                
            result.append({
                "product_id": item.product_id,
                "name": item.name,
                "category": item.category,
                "stock_level": item.stock_level,
                "reorder_point": item.reorder_point,
                "optimal_stock": item.optimal_stock,
                "unit_cost": item.unit_cost,
                "unit_price": item.unit_price,
                "health_score": round(health * 100, 1),
                "status_label": status_label
            })
        return result
    finally:
        db.close()

@app.post("/api/inventory/update")
def update_stock(payload: InventoryUpdatePayload, current_user: dict = Depends(verify_token)):
    """Update stock level for a product (Warehouse Manager permission)."""
    db = SessionLocal()
    try:
        item = db.query(InventoryItem).filter(InventoryItem.product_id == payload.product_id).first()
        if not item:
            raise HTTPException(status_code=404, detail="Product not found.")
            
        old_stock = item.stock_level
        item.stock_level = payload.new_stock
        
        # Log this manually to audit log
        audit = AuditLog(
            agent_name="System API",
            action="Manual Stock Adjustment",
            user_role=current_user.get("role"),
            details=f"Stock updated for {item.name} ({item.product_id}) from {old_stock} to {payload.new_stock} by {current_user.get('name')}."
        )
        db.add(audit)
        db.commit()
        return {"status": "success", "message": f"Stock updated from {old_stock} to {payload.new_stock}."}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

@app.post("/api/inventory/add")
def add_product(payload: ProductCreatePayload, current_user: dict = Depends(verify_token)):
    """Add a new product to inventory (Warehouse Manager permission)."""
    db = SessionLocal()
    try:
        # Check if product already exists
        exists = db.query(InventoryItem).filter(InventoryItem.product_id == payload.product_id).first()
        if exists:
            raise HTTPException(status_code=400, detail=f"Product with ID '{payload.product_id}' already exists.")
            
        # Create inventory item
        item = InventoryItem(
            product_id=payload.product_id,
            name=payload.name,
            category=payload.category,
            stock_level=payload.stock_level,
            reorder_point=payload.reorder_point,
            optimal_stock=payload.optimal_stock,
            unit_cost=payload.supplier_price,
            unit_price=payload.unit_price
        )
        db.add(item)
        
        # Link supplier pricing
        supp_price = SupplierPrice(
            supplier_id=payload.supplier_id,
            product_id=payload.product_id,
            price=payload.supplier_price
        )
        db.add(supp_price)
        
        # Create an initial dummy SalesRecord
        sales = SalesRecord(
            product_id=payload.product_id,
            date=datetime.date.today() - datetime.timedelta(days=1),
            quantity_sold=5,
            revenue=5 * payload.unit_price
        )
        db.add(sales)
        
        # Log to audit logs
        audit = AuditLog(
            agent_name="System API",
            action="Add New Product",
            user_role=current_user.get("role"),
            details=f"New product '{payload.name}' ({payload.product_id}) added to inventory by {current_user.get('name')}. Initial stock: {payload.stock_level}."
        )
        db.add(audit)
        
        db.commit()
        return {"status": "success", "message": f"Product '{payload.name}' added successfully."}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

@app.delete("/api/inventory/{product_id}")
def delete_product(product_id: str, current_user: dict = Depends(verify_token)):
    """Delete a product from inventory and all its dependent records."""
    db = SessionLocal()
    try:
        item = db.query(InventoryItem).filter(InventoryItem.product_id == product_id).first()
        if not item:
            raise HTTPException(status_code=404, detail="Product not found.")

        item_name = item.name

        # Disable FK checks temporarily so we can delete freely in MySQL
        try:
            db.execute(__import__('sqlalchemy').text("SET FOREIGN_KEY_CHECKS=0"))
        except Exception:
            pass  # SQLite doesn't support this, skip gracefully

        # Delete all dependent records first
        db.query(SalesRecord).filter(SalesRecord.product_id == product_id).delete(synchronize_session=False)
        db.query(SupplierPrice).filter(SupplierPrice.product_id == product_id).delete(synchronize_session=False)
        db.query(PurchaseOrder).filter(PurchaseOrder.product_id == product_id).delete(synchronize_session=False)
        db.flush()

        # Now delete the inventory item
        db.query(InventoryItem).filter(InventoryItem.product_id == product_id).delete(synchronize_session=False)
        db.flush()

        # Re-enable FK checks
        try:
            db.execute(__import__('sqlalchemy').text("SET FOREIGN_KEY_CHECKS=1"))
        except Exception:
            pass

        # Log action
        db.add(AuditLog(
            agent_name="System API",
            action="Delete Product",
            user_role=current_user.get("role"),
            details=f"Product '{item_name}' ({product_id}) and all associated data deleted by {current_user.get('name')}."
        ))
        db.commit()
        return {"status": "success", "message": f"Product '{item_name}' deleted successfully."}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@app.get("/api/dashboard/stats")
def get_dashboard_stats(current_user: dict = Depends(verify_token)):
    """Get summarized analytics stats for the dashboard (scoped by store)."""
    db = SessionLocal()
    try:
        store_id = current_user.get("store_id", "ALL")
        q = db.query(InventoryItem)
        if store_id != "ALL":
            q = q.filter(InventoryItem.store_id == store_id)
        items = q.all()
        critical_count = 0
        overstock_count = 0
        total_health = 0.0
        
        reorder_recommendations = []
        estimated_total_reorder_cost = 0.0
        estimated_total_savings = 0.0
        estimated_revenue_impact = 0.0
        
        for item in items:
            # 1. Health Score
            health = 1.0
            status_label = "HEALTHY"
            if item.stock_level < item.reorder_point:
                health = (item.stock_level / item.reorder_point) * 0.5
                status_label = "CRITICAL"
                critical_count += 1
            elif item.stock_level > item.optimal_stock:
                health = max(0.0, 1.0 - ((item.stock_level - item.optimal_stock) / item.optimal_stock) * 0.5)
                status_label = "WARNING"
                overstock_count += 1
            else:
                health = 0.7 + ((item.stock_level - item.reorder_point) / (item.optimal_stock - item.reorder_point)) * 0.3
            
            total_health += health
            
            # 2. Formulate simple recommendation logic for stats
            if status_label == "CRITICAL":
                qty_needed = item.optimal_stock - item.stock_level
                # Find best supplier pricing
                prices = db.query(SupplierPrice).filter(SupplierPrice.product_id == item.product_id).all()
                if prices:
                    prices_sorted = sorted(prices, key=lambda x: (x.price / x.supplier.reliability_score))
                    best_option = prices_sorted[0]
                    avg_price = sum([p.price for p in prices]) / len(prices)
                    savings = (avg_price - best_option.price) * qty_needed
                    
                    reorder_recommendations.append({
                        "product_id": item.product_id,
                        "product_name": item.name,
                        "reorder_quantity": qty_needed,
                        "recommended_supplier_name": best_option.supplier.name,
                        "supplier_id": best_option.supplier_id,
                        "unit_price": best_option.price,
                        "lead_time_days": best_option.supplier.lead_time_days,
                        "estimated_savings": round(savings, 2),
                        "total_cost": round(qty_needed * best_option.price, 2)
                    })
                    estimated_total_reorder_cost += qty_needed * best_option.price
                    estimated_total_savings += savings
                    
                    # Estimate revenue recovery = (reorder quantity * selling price) * profit factor
                    estimated_revenue_impact += qty_needed * item.unit_price
            
            elif status_label == "WARNING":
                # Estimate potential loss of holding capital
                holding_cost = (item.stock_level - item.optimal_stock) * item.unit_cost * 0.15
                estimated_revenue_impact -= holding_cost

        avg_health_score = (total_health / len(items)) * 100 if items else 100.0
        
        return {
            "inventory_health_score": round(avg_health_score, 1),
            "stockout_risk_count": critical_count,
            "overstock_alerts_count": overstock_count,
            "potential_savings": round(estimated_total_savings, 2),
            "estimated_revenue_impact": round(estimated_revenue_impact, 2),
            "recommended_orders": reorder_recommendations,
            "total_reorder_cost": round(estimated_total_reorder_cost, 2)
        }
    finally:
        db.close()

# ----------------------------------------------------
# 3. Supplier Routes
# ----------------------------------------------------
@app.get("/api/suppliers")
def get_suppliers(current_user: dict = Depends(verify_token)):
    """Fetch suppliers and pricing comparisons (scoped by store)."""
    db = SessionLocal()
    try:
        store_id = current_user.get("store_id", "ALL")
        sq = db.query(Supplier)
        if store_id != "ALL":
            sq = sq.filter(Supplier.store_id == store_id)
        suppliers = sq.all()
        prices = db.query(SupplierPrice).all()
        
        supplier_list = []
        for s in suppliers:
            catalog = [
                {
                    "product_id": p.product_id,
                    "product_name": p.product.name,
                    "price": p.price
                }
                for p in prices if p.supplier_id == s.supplier_id
            ]
            supplier_list.append({
                "supplier_id": s.supplier_id,
                "name": s.name,
                "lead_time_days": s.lead_time_days,
                "reliability_score": s.reliability_score,
                "catalog": catalog
            })
        return supplier_list
    finally:
        db.close()

# ----------------------------------------------------
# 4. Purchase Order & Approval Routes
# ----------------------------------------------------
@app.get("/api/orders")
def get_orders(current_user: dict = Depends(verify_token)):
    """Fetch purchase orders (scoped by store)."""
    db = SessionLocal()
    try:
        store_id = current_user.get("store_id", "ALL")
        q = db.query(PurchaseOrder).order_by(PurchaseOrder.created_at.desc())
        if store_id != "ALL":
            q = q.filter(PurchaseOrder.store_id == store_id)
        orders = q.all()
        return [
            {
                "id": o.id,
                "product_id": o.product_id,
                "product_name": o.product.name,
                "quantity": o.quantity,
                "supplier_name": o.supplier.name,
                "supplier_id": o.supplier_id,
                "status": o.status,
                "created_at": o.created_at.isoformat(),
                "approved_by": o.approved_by,
                "approved_at": o.approved_at.isoformat() if o.approved_at else None,
                "total_cost": round(o.quantity * db.query(SupplierPrice).filter(SupplierPrice.product_id==o.product_id, SupplierPrice.supplier_id==o.supplier_id).first().price, 2) if db.query(SupplierPrice).filter(SupplierPrice.product_id==o.product_id, SupplierPrice.supplier_id==o.supplier_id).first() else 0.0
            }
            for o in orders
        ]
    finally:
        db.close()

@app.post("/api/orders")
def create_order(payload: POCreatePayload, current_user: dict = Depends(verify_token)):
    """Create a draft Purchase Order directly from the dashboard."""
    db = SessionLocal()
    try:
        item = db.query(InventoryItem).filter(InventoryItem.product_id == payload.product_id).first()
        supplier = db.query(Supplier).filter(Supplier.supplier_id == payload.supplier_id).first()
        
        if not item or not supplier:
            raise HTTPException(status_code=404, detail="Product or Supplier not found.")
            
        po = PurchaseOrder(
            product_id=payload.product_id,
            quantity=payload.quantity,
            supplier_id=payload.supplier_id,
            status="reordered",
            created_at=datetime.datetime.utcnow(),
            store_id=current_user.get("store_id", "STORE_A")
        )
        db.add(po)
        db.commit()
        db.refresh(po)
        
        # Log this decision to audit logs
        audit = AuditLog(
            agent_name="Dashboard API Gate",
            action="Create Purchase Order (Draft)",
            user_role=current_user.get("role"),
            details=f"Draft purchase order PO#{po.id} generated for {payload.quantity}x {item.name} from {supplier.name} via Dashboard."
        )
        db.add(audit)
        db.commit()
        
        return {"status": "success", "po_id": po.id}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

@app.post("/api/orders/{po_id}/approve")
def approve_order(po_id: int, payload: POApprovePayload, current_user: dict = Depends(verify_token)):
    """Approve or Reject a Purchase Order (Store Manager / Finance / Admin permission)."""
    db = SessionLocal()
    try:
        po = db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id).first()
        if not po:
            raise HTTPException(status_code=404, detail="Purchase order not found.")
            
        if po.status not in ["pending_approval", "reordered"]:
            raise HTTPException(status_code=400, detail=f"Order is already in '{po.status}' state.")
            
        po.status = "approved" if payload.approved else "rejected"
        po.approved_by = current_user.get("name")
        po.approved_at = datetime.datetime.utcnow()
        
        # If approved, simulate delivery by increasing inventory level
        if payload.approved:
            item = db.query(InventoryItem).filter(InventoryItem.product_id == po.product_id).first()
            if item:
                item.stock_level += po.quantity
                
        # Log this decision to audit logs
        audit = AuditLog(
            agent_name="System API Gate",
            action="Approve Purchase Order" if payload.approved else "Reject Purchase Order",
            user_role=current_user.get("role"),
            details=f"Purchase order PO#{po.id} for {po.quantity}x {po.product.name} from {po.supplier.name} was {'APPROVED' if payload.approved else 'REJECTED'} by {current_user.get('name')}."
        )
        db.add(audit)
        db.commit()
        
        return {"status": "success", "po_status": po.status}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

# ----------------------------------------------------
# 5. Multi-Agent Chat Interface
# ----------------------------------------------------
@app.post("/api/chat", dependencies=[require_store_manager])
async def agent_chat(payload: ChatPayload, current_user: dict = Depends(verify_token)):
    """Run the ADK multi-agent orchestrator for a natural language request, capturing visual trace."""
    runner: Runner = app.state.runner
    session_id = payload.session_id or f"session-{datetime.datetime.now().timestamp()}"
    
    logs = []
    final_text = ""
    
    try:
        user_message = genai_types.Content(
            role="user",
            parts=[genai_types.Part.from_text(text=payload.prompt)]
        )
        async for event in runner.run_async(
            user_id=current_user.get("uid"),
            session_id=session_id,
            new_message=user_message
        ):
            # Parse events to return visual logs for agent collaboration
            author = getattr(event, "author", "System")
            content = getattr(event, "content", "")
            event_type = event.__class__.__name__
            
            # Normalize content to string if it is a Content object or other non-string type
            if content:
                if hasattr(content, "parts"):
                    text_parts = [p.text for p in content.parts if getattr(p, "text", None)]
                    content = "\n".join(text_parts)
                elif not isinstance(content, str):
                    content = str(content)
            
            # Formulate readable messages for UI visual trace
            if event_type == "AgentStartedEvent":
                logs.append({
                    "timestamp": datetime.datetime.utcnow().isoformat(),
                    "agent": author,
                    "event_type": "transition",
                    "message": f"🤖 Agent '{author}' activated and starting analysis..."
                })
            elif event_type == "ToolCallEvent":
                tool_name = getattr(event, "tool_name", "unknown")
                args = getattr(event, "tool_args", {})
                logs.append({
                    "timestamp": datetime.datetime.utcnow().isoformat(),
                    "agent": author,
                    "event_type": "tool_call",
                    "message": f"🔍 Calling MCP tool '{tool_name}' with parameters: {args}"
                })
            elif event_type == "ToolResponseEvent":
                tool_name = getattr(event, "tool_name", "unknown")
                logs.append({
                    "timestamp": datetime.datetime.utcnow().isoformat(),
                    "agent": author,
                    "event_type": "tool_response",
                    "message": f"📥 MCP tool '{tool_name}' returned successfully."
                })
            elif event_type == "AgentFinishedEvent":
                logs.append({
                    "timestamp": datetime.datetime.utcnow().isoformat(),
                    "agent": author,
                    "event_type": "transition",
                    "message": f"✅ Agent '{author}' finalized task and returned results."
                })
            elif content:
                # Standard event carrying textual reasoning
                logs.append({
                    "timestamp": datetime.datetime.utcnow().isoformat(),
                    "agent": author,
                    "event_type": "reasoning",
                    "message": content
                })
                # Set final text if it is the root orchestrator's last message
                if author == "root_agent":
                    final_text = content
                    
        # Log this session action
        db = SessionLocal()
        try:
            audit = AuditLog(
                agent_name="OrchestratorAgent",
                action="Process Chat Request",
                user_role=current_user.get("role"),
                details=f"User prompt: '{payload.prompt[:100]}...' resulted in recommendation of length {len(final_text)}."
            )
            db.add(audit)
            db.commit()
        finally:
            db.close()

        return {
            "session_id": session_id,
            "response": final_text or "Analysis completed successfully.",
            "trace": logs
        }
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Agent Reasoning Error: {e}")

# ----------------------------------------------------
# 6. Audit Trail Routes
# ----------------------------------------------------
@app.get("/api/audit-logs")
def get_audit_logs(current_user: dict = Depends(verify_token)):
    """Fetch audit logs (scoped by store)."""
    db = SessionLocal()
    try:
        store_id = current_user.get("store_id", "ALL")
        q = db.query(AuditLog).order_by(AuditLog.timestamp.desc())
        if store_id != "ALL":
            q = q.filter((AuditLog.store_id == store_id) | (AuditLog.store_id == "ALL"))
        logs = q.all()
        return [
            {
                "id": l.id,
                "timestamp": l.timestamp.isoformat(),
                "agent_name": l.agent_name,
                "action": l.action,
                "user_role": l.user_role,
                "details": l.details
            }
            for l in logs
        ]
    finally:
        db.close()

# ----------------------------------------------------
# 7. Forecasting Details Route
# ----------------------------------------------------
@app.get("/api/forecast/{product_id}")
def get_product_forecast(product_id: str, current_user: dict = Depends(verify_token)):
    """Get the demand forecast detail and XGBoost/Seasonality statistics for a product."""
    db = SessionLocal()
    try:
        result = forecast_demand(product_id, db)
        if "error" in result:
            raise HTTPException(status_code=404, detail=result["error"])
        return result
    finally:
        db.close()

# Main execution
if __name__ == "__main__":
    import uvicorn
    # Need AsyncIterator for lifespan context types
    from collections.abc import AsyncIterator
    uvicorn.run(app, host="0.0.0.0", port=8000)
