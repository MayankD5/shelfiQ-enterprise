import os
import sys
import datetime
from mcp.server.fastmcp import FastMCP
from sqlalchemy.orm import Session
from app.db import SessionLocal, InventoryItem, SalesRecord, SupplierPrice, Supplier, PurchaseOrder, AuditLog

# Add current directory to path to prevent import errors when run as subprocess
sys.path.append(os.path.abspath(os.path.dirname(__file__)))

mcp = FastMCP("shelfiq_mcp_server")

@mcp.tool()
def get_inventory() -> list[dict]:
    """Retrieve the current inventory levels for all products in the database.
    
    Returns:
        A list of products with their stock levels, reorder points, optimal stock levels, and costs.
    """
    db = SessionLocal()
    try:
        items = db.query(InventoryItem).all()
        return [
            {
                "product_id": item.product_id,
                "name": item.name,
                "category": item.category,
                "stock_level": item.stock_level,
                "reorder_point": item.reorder_point,
                "optimal_stock": item.optimal_stock,
                "unit_cost": item.unit_cost,
                "unit_price": item.unit_price
            }
            for item in items
        ]
    finally:
        db.close()

@mcp.tool()
def get_sales_history(product_id: str) -> list[dict]:
    """Retrieve historical daily sales records for a specific product over the last 60 days.
    
    Args:
        product_id: The unique identifier of the product (e.g., PROD001).
        
    Returns:
        A list of daily sales records containing the date, quantity sold, and revenue.
    """
    db = SessionLocal()
    try:
        records = db.query(SalesRecord).filter(SalesRecord.product_id == product_id).order_by(SalesRecord.date.desc()).all()
        return [
            {
                "date": record.date.strftime("%Y-%m-%d"),
                "quantity_sold": record.quantity_sold,
                "revenue": record.revenue
            }
            for record in records
        ]
    finally:
        db.close()

@mcp.tool()
def get_supplier_prices(product_id: str) -> list[dict]:
    """Compare pricing and delivery lead times from different suppliers for a specific product.
    
    Args:
        product_id: The unique identifier of the product (e.g., PROD003).
        
    Returns:
        A list of suppliers showing their offered unit price, delivery lead time in days, and historical reliability score.
    """
    db = SessionLocal()
    try:
        options = db.query(SupplierPrice).filter(SupplierPrice.product_id == product_id).all()
        return [
            {
                "supplier_id": opt.supplier_id,
                "supplier_name": opt.supplier.name,
                "unit_price": opt.price,
                "lead_time_days": opt.supplier.lead_time_days,
                "reliability_score": opt.supplier.reliability_score
            }
            for opt in options
        ]
    finally:
        db.close()

@mcp.tool()
def create_purchase_order(product_id: str, quantity: int, supplier_id: str) -> dict:
    """Create a pending purchase order for reordering stock. Requires human approval.
    
    Args:
        product_id: The unique identifier of the product to reorder.
        quantity: The quantity of the product to order.
        supplier_id: The ID of the supplier to order from.
        
    Returns:
        A dictionary containing the purchase order status, PO ID, and a notice regarding pending manager approval.
    """
    db = SessionLocal()
    try:
        # Validate product and supplier
        item = db.query(InventoryItem).filter(InventoryItem.product_id == product_id).first()
        supplier = db.query(Supplier).filter(Supplier.supplier_id == supplier_id).first()
        
        if not item:
            return {"status": "error", "message": f"Product '{product_id}' not found."}
        if not supplier:
            return {"status": "error", "message": f"Supplier '{supplier_id}' not found."}
        if quantity <= 0:
            return {"status": "error", "message": "Order quantity must be greater than zero."}
            
        po = PurchaseOrder(
            product_id=product_id,
            quantity=quantity,
            supplier_id=supplier_id,
            status="pending_approval"
        )
        db.add(po)
        db.commit()
        db.refresh(po)
        
        # Log this decision to audit log
        audit = AuditLog(
            agent_name="SupplierIntelligenceAgent",
            action="Create Purchase Order (Draft)",
            user_role="AI Agent",
            details=f"Generated draft purchase order PO#{po.id} for {quantity}x {item.name} from {supplier.name}. Status: pending_approval."
        )
        db.add(audit)
        db.commit()
        
        return {
            "status": "success",
            "po_id": po.id,
            "product_name": item.name,
            "quantity": quantity,
            "supplier_name": supplier.name,
            "total_estimated_cost": round(quantity * po.supplier.reliability_score, 2), # price from supplier list
            "message": "Purchase order draft created in 'pending_approval' state. Human-in-the-loop approval is required to finalize this order."
        }
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": f"Failed to create purchase order: {e}"}
    finally:
        db.close()

@mcp.tool()
def send_email_notification(to_email: str, subject: str, body: str) -> dict:
    """Send an email notification report to managers or finance staff.
    
    Args:
        to_email: The recipient's email address.
        subject: The subject line of the email.
        body: The markdown body content of the report.
        
    Returns:
        A dictionary with the email transmission status.
    """
    db = SessionLocal()
    try:
        audit = AuditLog(
            agent_name="ExecutiveInsightsAgent",
            action="Send Email Notification",
            user_role="AI Agent",
            details=f"Email report sent to {to_email}. Subject: '{subject}'"
        )
        db.add(audit)
        db.commit()
        return {
            "status": "sent",
            "timestamp": datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
            "to": to_email,
            "subject": subject,
            "message": "Simulated email notification dispatched successfully."
        }
    finally:
        db.close()

@mcp.tool()
def get_holiday_calendar() -> list[dict]:
    """Retrieve the calendar of upcoming retail events or holidays.
    
    Returns:
        A list of upcoming holiday dates and details describing expected demand shifts.
    """
    # Simulate a holiday calendar
    return [
        {
            "date": "2026-07-04",
            "holiday": "Independence Day",
            "demand_impact": "High demand surge for Beverages, Dairy, and Bakery products."
        },
        {
            "date": "2026-09-07",
            "holiday": "Labor Day",
            "demand_impact": "Increased sales volume for Dairy, Bakery, and Household goods."
        },
        {
            "date": "2026-11-26",
            "holiday": "Thanksgiving Day",
            "demand_impact": "Massive demand surge across all food categories (Beverages, Dairy, Produce, Bakery)."
        }
    ]

@mcp.tool()
def get_weather_forecast() -> list[dict]:
    """Retrieve the upcoming week's weather forecast.
    
    Returns:
        A list of daily weather forecasts indicating expected customer traffic impacts.
    """
    # Simulate a weather forecast
    today = datetime.date.today()
    forecasts = []
    conditions = ["Sunny", "Partly Cloudy", "Rainy", "Overcast", "Sunny"]
    traffic_impacts = [
        "Optimal customer foot traffic expected.",
        "Normal customer foot traffic expected.",
        "Reduced store foot traffic; online delivery demand may increase.",
        "Slightly reduced store foot traffic.",
        "Optimal customer foot traffic expected."
    ]
    for i in range(5):
        day = today + datetime.timedelta(days=i)
        forecasts.append({
            "date": day.strftime("%Y-%m-%d"),
            "temp_f": 72 + (i * 3) - (i * i),
            "condition": conditions[i % len(conditions)],
            "traffic_impact": traffic_impacts[i % len(traffic_impacts)]
        })
    return forecasts

if __name__ == "__main__":
    mcp.run()
