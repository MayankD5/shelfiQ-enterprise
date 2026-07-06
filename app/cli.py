import click
import sys
import os

# Add parent directory to path to ensure modules are resolved
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.db import SessionLocal, init_db, InventoryItem, SupplierPrice, Supplier
from app.forecaster import forecast_demand

# Make sure DB is initialized
init_db()

@click.group()
def cli():
    """ShelfIQ Enterprise — AI-Powered Multi-Agent CLI Utility"""
    pass

@cli.command()
@click.argument("product_id")
@click.option("--days", default=14, help="Number of days to forecast.")
def forecast(product_id, days):
    """Analyze historical sales and forecast future demand."""
    click.echo(f"=== ShelfIQ Demand Forecast for {product_id} ===")
    db = SessionLocal()
    try:
        result = forecast_demand(product_id, db, days_to_forecast=days)
        if "error" in result:
            click.echo(click.style(result["error"], fg="red"))
            return
            
        click.echo(f"Forecast dates: {', '.join(result['forecast_dates'][:7])} ...")
        click.echo(f"Forecast quantities: {', '.join(map(str, result['forecast_quantities'][:7]))} ...")
        click.echo(f"Stockout Risk Detected: {result['stockout_risk_detected']}")
        click.echo(f"Days to Stockout: {result['days_to_stockout']}")
        click.echo(f"Explanation: {result['explanation']}")
    finally:
        db.close()

@cli.command()
def reorder():
    """Display products approaching stockout and recommended order quantities."""
    click.echo("=== ShelfIQ Reorder Recommendations ===")
    db = SessionLocal()
    try:
        items = db.query(InventoryItem).all()
        critical_items = [i for i in items if i.stock_level < i.reorder_point]
        if not critical_items:
            click.echo(click.style("All inventory levels are healthy. No reorders needed.", fg="green"))
            return
            
        click.echo(f"Found {len(critical_items)} critical items requiring reorder:")
        for item in critical_items:
            qty_needed = item.optimal_stock - item.stock_level
            prices = db.query(SupplierPrice).filter(SupplierPrice.product_id == item.product_id).all()
            click.echo(f"\nProduct: {item.name} ({item.product_id})")
            click.echo(f"  Current Stock: {item.stock_level} (Reorder point: {item.reorder_point})")
            click.echo(f"  Suggested Reorder Qty: {qty_needed}")
            
            if prices:
                prices_sorted = sorted(prices, key=lambda x: (x.price / x.supplier.reliability_score))
                best = prices_sorted[0]
                click.echo(f"  Recommended Supplier: {best.supplier.name} (${best.price}/unit, lead time {best.supplier.lead_time_days} days)")
            else:
                click.echo("  No supplier pricing found.")
    finally:
        db.close()

@cli.command()
@click.argument("product_id")
def suppliers(product_id):
    """Compare prices, lead times, and reliability from all suppliers."""
    click.echo(f"=== Supplier Comparison for {product_id} ===")
    db = SessionLocal()
    try:
        options = db.query(SupplierPrice).filter(SupplierPrice.product_id == product_id).all()
        if not options:
            click.echo(click.style(f"No supplier pricing options found for {product_id}.", fg="red"))
            return
            
        click.echo(f"{'Supplier Name':<30} | {'Price':<6} | {'Lead Time':<9} | {'Reliability':<11}")
        click.echo("-" * 68)
        for opt in options:
            click.echo(f"{opt.supplier.name:<30} | ${opt.price:<5.2f} | {opt.supplier.lead_time_days:<4} days | {opt.supplier.reliability_score:<11.2f}")
    finally:
        db.close()

@cli.command()
def report():
    """Generate high-level inventory health and business outcome summary."""
    click.echo("=== ShelfIQ Inventory Health Executive Report ===")
    db = SessionLocal()
    try:
        items = db.query(InventoryItem).all()
        total_health = 0.0
        critical_count = 0
        overstock_count = 0
        
        for item in items:
            if item.stock_level < item.reorder_point:
                health = (item.stock_level / item.reorder_point) * 0.5
                critical_count += 1
            elif item.stock_level > item.optimal_stock:
                health = max(0.0, 1.0 - ((item.stock_level - item.optimal_stock) / item.optimal_stock) * 0.5)
                overstock_count += 1
            else:
                health = 0.7 + ((item.stock_level - item.reorder_point) / (item.optimal_stock - item.reorder_point)) * 0.3
            total_health += health
            
        avg_health = (total_health / len(items)) * 100 if items else 100.0
        click.echo(f"Average Inventory Health: {avg_health:.1f}%")
        click.echo(f"Critical Stockout Risks: {critical_count} products")
        click.echo(f"Overstock Alerts: {overstock_count} products")
        click.echo("AI Recommendation: Use 'shelfiq reorder' to view reorder sheets.")
    finally:
        db.close()

if __name__ == "__main__":
    cli()
