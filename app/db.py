import os
import sys
import hashlib
import datetime
import random
from sqlalchemy import create_engine, Column, Integer, String, Float, Date, DateTime, ForeignKey
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

Base = declarative_base()

# -------------------------------------------------------
# Models
# -------------------------------------------------------

class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(100), unique=True, nullable=False)
    password_hash = Column(String(64), nullable=False)
    name = Column(String(100), nullable=False)
    role = Column(String(50), nullable=False)
    store_id = Column(String(50), nullable=False)  # which store they belong to

class InventoryItem(Base):
    __tablename__ = 'inventory_items'
    product_id = Column(String(50), primary_key=True)
    name = Column(String(100), nullable=False)
    category = Column(String(50))
    stock_level = Column(Integer, default=0)
    reorder_point = Column(Integer, default=10)
    optimal_stock = Column(Integer, default=50)
    unit_cost = Column(Float, default=0.0)
    unit_price = Column(Float, default=0.0)
    store_id = Column(String(50), default='STORE_A')  # scope inventory per store

class SalesRecord(Base):
    __tablename__ = 'sales_records'
    id = Column(Integer, primary_key=True, autoincrement=True)
    product_id = Column(String(50), ForeignKey('inventory_items.product_id'))
    date = Column(Date, nullable=False)
    quantity_sold = Column(Integer, nullable=False)
    revenue = Column(Float, nullable=False)
    store_id = Column(String(50), default='STORE_A')
    product = relationship("InventoryItem")

class Supplier(Base):
    __tablename__ = 'suppliers'
    supplier_id = Column(String(50), primary_key=True)
    name = Column(String(100), nullable=False)
    lead_time_days = Column(Integer, default=3)
    reliability_score = Column(Float, default=0.9)
    store_id = Column(String(50), default='STORE_A')  # which store uses this supplier

class SupplierPrice(Base):
    __tablename__ = 'supplier_prices'
    id = Column(Integer, primary_key=True, autoincrement=True)
    supplier_id = Column(String(50), ForeignKey('suppliers.supplier_id'))
    product_id = Column(String(50), ForeignKey('inventory_items.product_id'))
    price = Column(Float, nullable=False)
    supplier = relationship("Supplier")
    product = relationship("InventoryItem")

class PurchaseOrder(Base):
    __tablename__ = 'purchase_orders'
    id = Column(Integer, primary_key=True, autoincrement=True)
    product_id = Column(String(50), ForeignKey('inventory_items.product_id'))
    quantity = Column(Integer, nullable=False)
    supplier_id = Column(String(50), ForeignKey('suppliers.supplier_id'))
    status = Column(String(50), default="pending_approval")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    approved_by = Column(String(100))
    approved_at = Column(DateTime)
    store_id = Column(String(50), default='STORE_A')
    product = relationship("InventoryItem")
    supplier = relationship("Supplier")

class AuditLog(Base):
    __tablename__ = 'audit_logs'
    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    agent_name = Column(String(100), nullable=False)
    action = Column(String(255), nullable=False)
    user_role = Column(String(50))
    store_id = Column(String(50), default='STORE_A')
    details = Column(String(2000))

# -------------------------------------------------------
# Helpers
# -------------------------------------------------------

def hash_password(plain: str) -> str:
    return hashlib.sha256(plain.encode()).hexdigest()

# -------------------------------------------------------
# Database Engine Initialization
# -------------------------------------------------------
MYSQL_URL = "mysql+pymysql://root:102030@localhost/shelfiq?charset=utf8mb4"

engine = None
SessionLocal = None

try:
    import pymysql
    conn = pymysql.connect(host="localhost", user="root", password="102030")
    cursor = conn.cursor()
    cursor.execute("CREATE DATABASE IF NOT EXISTS shelfiq;")
    conn.commit()
    cursor.close()
    conn.close()
    print("Database: Assured 'shelfiq' MySQL database exists.", file=sys.stderr)

    engine = create_engine(MYSQL_URL, connect_args={"connect_timeout": 3})
    with engine.connect() as conn:
        pass
    print("Database: Connected successfully to MySQL.", file=sys.stderr)
except Exception as e:
    print(f"Database: MySQL connection failed ({e}). Falling back to SQLite.", file=sys.stderr)
    db_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "shelfiq.db"))
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# -------------------------------------------------------
# Database Initialization & Seeding
# -------------------------------------------------------

def init_db():
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        # Re-seed if no users exist yet (fresh start)
        if db.query(User).count() > 0:
            print("Database: Already seeded.", file=sys.stderr)
            return

        print("Database: Seeding initial data...", file=sys.stderr)

        # ── 1. Users ────────────────────────────────────────────────────────
        users = [
            User(email="admin@shelfiq.com",     password_hash=hash_password("Admin@123"),
                 name="Alex Admin",       role="Admin",             store_id="ALL"),
            User(email="sarah@shelfiq.com",     password_hash=hash_password("Sarah@123"),
                 name="Sarah Miller",     role="Store Manager",     store_id="STORE_A"),
            User(email="mike@shelfiq.com",      password_hash=hash_password("Mike@123"),
                 name="Mike Johnson",     role="Warehouse Manager", store_id="STORE_B"),
            User(email="lisa@shelfiq.com",      password_hash=hash_password("Lisa@123"),
                 name="Lisa Chen",        role="Finance",           store_id="STORE_A"),
        ]
        db.add_all(users)
        db.commit()

        # ── 2. Suppliers ─────────────────────────────────────────────────────
        #   STORE_A suppliers (Downtown Grocery)
        suppliers_a = [
            Supplier(supplier_id="SUP001", name="Global Logistics Corp",     lead_time_days=2, reliability_score=0.95, store_id="STORE_A"),
            Supplier(supplier_id="SUP002", name="Fresh Food Distributors",   lead_time_days=4, reliability_score=0.88, store_id="STORE_A"),
        ]
        #   STORE_B suppliers (North Warehouse)
        suppliers_b = [
            Supplier(supplier_id="SUP003", name="EcoClean Industries",       lead_time_days=3, reliability_score=0.92, store_id="STORE_B"),
            Supplier(supplier_id="SUP004", name="Apex Retail Supplies",      lead_time_days=6, reliability_score=0.97, store_id="STORE_B"),
        ]
        db.add_all(suppliers_a + suppliers_b)
        db.commit()

        # ── 3. Inventory Items ───────────────────────────────────────────────
        #   STORE_A — Downtown Grocery Branch (fresh / daily goods)
        items_a = [
            InventoryItem(product_id="PROD001", name="Whole Milk 1G",           category="Dairy",     stock_level=12,  reorder_point=25, optimal_stock=80, unit_cost=2.20, unit_price=3.99,  store_id="STORE_A"),
            InventoryItem(product_id="PROD002", name="Organic Bread",           category="Bakery",    stock_level=8,   reorder_point=15, optimal_stock=40, unit_cost=1.80, unit_price=3.49,  store_id="STORE_A"),
            InventoryItem(product_id="PROD003", name="Premium Coffee Beans 1lb",category="Beverages", stock_level=42,  reorder_point=20, optimal_stock=60, unit_cost=6.50, unit_price=12.99, store_id="STORE_A"),
            InventoryItem(product_id="PROD004", name="Gala Apples 5lb Bag",    category="Produce",   stock_level=5,   reorder_point=12, optimal_stock=35, unit_cost=3.00, unit_price=5.99,  store_id="STORE_A"),
        ]
        #   STORE_B — North Warehouse Branch (bulk / household / industrial)
        items_b = [
            InventoryItem(product_id="PROD005", name="Eco Detergent 100oz",    category="Household",      stock_level=25, reorder_point=10, optimal_stock=30, unit_cost=7.20, unit_price=14.99, store_id="STORE_B"),
            InventoryItem(product_id="PROD006", name="Baby Diapers Size 3",    category="Baby",           stock_level=4,  reorder_point=10, optimal_stock=25, unit_cost=18.00,unit_price=29.99, store_id="STORE_B"),
            InventoryItem(product_id="PROD007", name="Herbal Shampoo",         category="Personal Care",  stock_level=35, reorder_point=8,  optimal_stock=20, unit_cost=3.50, unit_price=7.99,  store_id="STORE_B"),
            InventoryItem(product_id="PROD008", name="Bulk Paper Towels 12pk", category="Household",      stock_level=7,  reorder_point=15, optimal_stock=50, unit_cost=5.00, unit_price=11.99, store_id="STORE_B"),
        ]
        db.add_all(items_a + items_b)
        db.commit()

        # ── 4. Supplier Prices ───────────────────────────────────────────────
        prices_a = [
            SupplierPrice(supplier_id="SUP001", product_id="PROD001", price=2.40),
            SupplierPrice(supplier_id="SUP002", product_id="PROD001", price=2.20),
            SupplierPrice(supplier_id="SUP002", product_id="PROD002", price=1.80),
            SupplierPrice(supplier_id="SUP001", product_id="PROD003", price=6.80),
            SupplierPrice(supplier_id="SUP002", product_id="PROD004", price=3.00),
            SupplierPrice(supplier_id="SUP001", product_id="PROD004", price=3.40),
        ]
        prices_b = [
            SupplierPrice(supplier_id="SUP003", product_id="PROD005", price=7.20),
            SupplierPrice(supplier_id="SUP004", product_id="PROD005", price=7.80),
            SupplierPrice(supplier_id="SUP004", product_id="PROD006", price=18.00),
            SupplierPrice(supplier_id="SUP003", product_id="PROD006", price=19.50),
            SupplierPrice(supplier_id="SUP003", product_id="PROD007", price=3.50),
            SupplierPrice(supplier_id="SUP004", product_id="PROD007", price=3.20),
            SupplierPrice(supplier_id="SUP003", product_id="PROD008", price=5.00),
            SupplierPrice(supplier_id="SUP004", product_id="PROD008", price=4.60),
        ]
        db.add_all(prices_a + prices_b)
        db.commit()

        # ── 5. Sales History (60 days) ────────────────────────────────────────
        today = datetime.date.today()
        all_items = items_a + items_b
        sales_records = []
        for i in range(60, 0, -1):
            date_val = today - datetime.timedelta(days=i)
            is_weekend = date_val.weekday() in [5, 6]
            for item in all_items:
                if item.product_id == "PROD001": base = 12
                elif item.product_id == "PROD002": base = 8
                elif item.product_id == "PROD003":
                    base = 6 * (1.0 + (60 - i) / 120.0)
                elif item.product_id == "PROD004": base = 5
                elif item.product_id == "PROD005": base = 2
                elif item.product_id == "PROD006": base = 1.5
                elif item.product_id == "PROD007": base = 1.2
                else: base = 3  # PROD008
                seasonality = 1.5 if is_weekend else 0.8
                noise = random.uniform(0.8, 1.2)
                quantity = max(1, int(base * seasonality * noise))
                revenue = round(quantity * item.unit_price, 2)
                sales_records.append(SalesRecord(
                    product_id=item.product_id,
                    date=date_val,
                    quantity_sold=quantity,
                    revenue=revenue,
                    store_id=item.store_id
                ))
        db.add_all(sales_records)
        db.commit()

        # ── 6. Seed Audit Log ─────────────────────────────────────────────────
        db.add(AuditLog(
            agent_name="System",
            action="Database Seeding",
            user_role="System",
            store_id="ALL",
            details="Seeded 4 users, 2 stores (STORE_A & STORE_B), 8 products, 4 suppliers, and 60 days of sales history."
        ))
        db.commit()
        print("Database: Seeded successfully.", file=sys.stderr)

    except Exception as e:
        print(f"Database: Seeding error: {e}", file=sys.stderr)
        db.rollback()
    finally:
        db.close()
