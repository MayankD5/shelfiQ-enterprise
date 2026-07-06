import os
import sys
import datetime
from pydantic import BaseModel, Field
from typing import List, Optional

from google.adk.agents import Agent
from google.adk.apps import App
from google.adk.models import Gemini
from google.adk.tools.mcp_tool import McpToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StdioConnectionParams
from mcp import StdioServerParameters
from google.genai import types

# Add parent directory to path to allow importing packages
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# Shared Model Configuration
# Using gemini-2.5-flash for all agents as selected
model_config = Gemini(
    model="gemini-2.5-flash",
    retry_options=types.HttpRetryOptions(
        attempts=6,
        initial_delay=8.0,
        max_delay=30.0,
        exp_base=1.5,
    ),
)

# Connect to the MCP Server
# We run the MCP server in a separate python process using uv
mcp_server_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "mcp_server.py"))

def make_mcp_tools():
    return McpToolset(
        connection_params=StdioConnectionParams(
            server_params=StdioServerParameters(
                command=sys.executable,
                args=["-u", mcp_server_path],
            ),
        )
    )

# ----------------------------------------------------
# 1. Demand Forecast Agent
# ----------------------------------------------------
class ForecastRequest(BaseModel):
    product_ids: List[str] = Field(description="List of product IDs to forecast demand for.")
    days: int = Field(default=14, description="Number of days into the future to forecast.")

class ProductForecast(BaseModel):
    product_id: str
    forecast_quantities: List[float]
    stockout_risk_detected: bool
    days_to_stockout: int
    explanation: str

class ForecastResponse(BaseModel):
    forecasts: List[ProductForecast]
    summary_insight: str

demand_forecast_agent = Agent(
    name="demand_forecast_agent",
    model=model_config,
    mode="task",
    description="Analyzes historical sales data, seasonality, weather and holiday events to predict future demand and stockout risks.",
    output_schema=ForecastResponse,
    instruction="""
    You are the Demand Forecast Agent.
    Your job is to analyze historical sales data, seasonality, and upcoming holidays or weather forecasts to predict future demand for products.
    For each product:
    1. Call get_sales_history to fetch the daily sales records.
    2. Check get_holiday_calendar and get_weather_forecast to identify any external factors that will affect foot traffic or sales.
    3. Generate the sales prediction. (Explain that you utilize rolling averages and XGBoost regression behind the scenes).
    4. Flag stockout risks (e.g. if current stock is below reorder points or predicted cumulative demand exceeds stock within the week).
    Provide the output structured according to the ForecastResponse schema, and call finish_task when done.
    """,
    tools=[make_mcp_tools()],
)

# ----------------------------------------------------
# 2. Inventory Monitoring Agent
# ----------------------------------------------------
class InventoryRequest(BaseModel):
    check_all: bool = Field(default=True, description="Whether to check all items or just specific categories.")
    categories: Optional[List[str]] = Field(default=None, description="Optional categories to check.")

class InventoryStatus(BaseModel):
    product_id: str
    product_name: str
    stock_level: int
    reorder_point: int
    optimal_stock: int
    health_score: float = Field(description="Inventory health score from 0.0 to 1.0.")
    status_label: str = Field(description="CRITICAL, WARNING (Overstock), or HEALTHY.")

class InventoryResponse(BaseModel):
    items: List[InventoryStatus]
    average_health: float
    critical_stockouts_count: int
    overstock_warnings_count: int
    insight_summary: str

inventory_monitoring_agent = Agent(
    name="inventory_monitoring_agent",
    model=model_config,
    mode="task",
    description="Monitors inventory stock levels, calculates inventory health scores, and identifies critical stockouts or overstocked items.",
    output_schema=InventoryResponse,
    instruction="""
    You are the Inventory Monitoring Agent.
    Your job is to check current stock levels and calculate inventory health.
    1. Call get_inventory to fetch all product data.
    2. Calculate an Inventory Health Score (0.0 to 1.0) for each product based on current stock vs. reorder point vs. optimal stock:
       - Critical (stock_level < reorder_point): Health = (stock_level / reorder_point) * 0.5
       - Healthy (reorder_point <= stock_level <= optimal_stock): Health = 0.7 + ((stock_level - reorder_point) / (optimal_stock - reorder_point)) * 0.3
       - Overstocked (stock_level > optimal_stock): Health = max(0.0, 1.0 - ((stock_level - optimal_stock) / optimal_stock) * 0.5)
    3. Categorize products as:
       - 'CRITICAL' if stock_level < reorder_point (stockout risk)
       - 'WARNING' if stock_level > optimal_stock * 1.3 (overstock risk)
       - 'HEALTHY' otherwise.
    Provide the output structured according to the InventoryResponse schema, and call finish_task when done.
    """,
    tools=[make_mcp_tools()],
)

# ----------------------------------------------------
# 3. Supplier Intelligence Agent
# ----------------------------------------------------
class SupplierRequest(BaseModel):
    product_id: str
    reorder_quantity: int

class SupplierComparison(BaseModel):
    supplier_id: str
    supplier_name: str
    unit_price: float
    lead_time_days: int
    reliability_score: float
    total_estimated_cost: float
    rank: int

class SupplierResponse(BaseModel):
    product_id: str
    reorder_quantity: int
    recommended_supplier_id: str
    recommended_supplier_name: str
    comparisons: List[SupplierComparison]
    estimated_savings: float = Field(description="Savings from choosing recommended supplier vs. average supplier price.")
    reasoning: str
    draft_po_created: bool
    draft_po_id: Optional[int] = None

supplier_intelligence_agent = Agent(
    name="supplier_intelligence_agent",
    model=model_config,
    mode="task",
    description="Compares supplier pricing, lead times, and reliability to recommend the best supplier, and initiates draft purchase orders.",
    output_schema=SupplierResponse,
    instruction="""
    You are the Supplier Intelligence Agent.
    Your job is to compare suppliers and recommend the best procurement option.
    1. Call get_supplier_prices for the given product_id.
    2. Compare the options. Calculate Total Expected Procurement Cost = (reorder_quantity * unit_price) / reliability_score.
    3. Rank suppliers (rank 1 is the lowest expected cost).
    4. Calculate estimated savings: (Average Unit Price - Recommended Unit Price) * reorder_quantity.
    5. Call create_purchase_order tool to create a draft PO with the recommended supplier and reorder quantity. Save the returned po_id.
    Provide the output structured according to the SupplierResponse schema, and call finish_task when done.
    """,
    tools=[make_mcp_tools()],
)

# ----------------------------------------------------
# 4. Pricing Optimization Agent
# ----------------------------------------------------
class PricingRequest(BaseModel):
    product_id: str
    current_stock: int
    status_label: str  # CRITICAL, WARNING, HEALTHY

class PricingResponse(BaseModel):
    product_id: str
    recommended_action: str = Field(description="DISCOUNT, MARKUP, or NO_CHANGE.")
    recommended_adjustment_pct: float = Field(description="e.g. -0.15 for 15% discount, +0.10 for 10% markup, 0.0 for no change.")
    new_suggested_price: float
    expected_revenue_impact: float = Field(description="Estimated financial change based on baseline sales volume.")
    reasoning: str

pricing_optimization_agent = Agent(
    name="pricing_optimization_agent",
    model=model_config,
    mode="task",
    description="Formulates pricing adjustments, such as markdown discounts for overstocked items or markup increases during high demand.",
    output_schema=PricingResponse,
    instruction="""
    You are the Pricing Optimization Agent.
    Your job is to suggest price adjustments to optimize inventory clearance or profit margins.
    1. Fetch get_sales_history for the product to see its current price and average weekly revenue.
    2. Suggest:
       - DISCOUNT (e.g. -10% to -25%) if status_label is 'WARNING' (overstocked) to move products faster.
       - MARKUP (e.g. +5% to +15%) if status_label is 'CRITICAL' (approaching stockout or in extremely high demand) to capture margin.
       - NO_CHANGE (0.0) if status_label is 'HEALTHY'.
    3. Calculate the new suggested price.
    4. Estimate revenue impact:
       - For discounts: (New Price * 1.3 - Current Price) * Weekly Sales Volume (volume increases by 30% on average during discount).
       - For markups: (New Price * 0.9 - Current Price) * Weekly Sales Volume (volume decreases by 10% on average during markup).
    Provide the output structured according to the PricingResponse schema, and call finish_task when done.
    """,
    tools=[make_mcp_tools()],
)

# ----------------------------------------------------
# 5. Executive Insights Agent
# ----------------------------------------------------
class ExecutiveRequest(BaseModel):
    analysis_data: str = Field(description="Textual summary of findings from Demand Forecast, Inventory, Supplier, and Pricing agents.")

class ExecutiveResponse(BaseModel):
    executive_summary: str = Field(description="High-level summary of the overall business recommendations.")
    actionable_points: List[str] = Field(description="Bulleted list of key actionable steps for management.")
    estimated_total_reorder_cost: float
    estimated_total_savings: float
    estimated_revenue_impact: float
    email_notification_sent: bool
    recipient_email: Optional[str] = None

executive_insights_agent = Agent(
    name="executive_insights_agent",
    model=model_config,
    mode="task",
    description="Synthesizes all agent outputs into a premium executive report, calculating total business value, and sends email notifications.",
    output_schema=ExecutiveResponse,
    instruction="""
    You are the Executive Insights Agent.
    Your job is to compile the final executive report.
    1. Review the analysis data (incorporating inventory levels, forecast risks, supplier selections, and price changes).
    2. Summarize the business outcomes (reorder cost, supplier savings, revenue impact).
    3. Compile an executive summary and a list of actionable points.
    4. Call the send_email_notification tool to email this report to 'manager@shelfiq.com'. Set email_notification_sent to True.
    Provide the output structured according to the ExecutiveResponse schema, and call finish_task when done.
    """,
    tools=[make_mcp_tools()],
)

# ----------------------------------------------------
# 6. Orchestrator Agent (Root Agent)
# ----------------------------------------------------
root_agent = Agent(
    name="root_agent",
    model=model_config,
    description="ShelfIQ Root Orchestrator. Coordinates the specialized inventory, forecasting, supplier, pricing, and insights agents.",
    instruction="""
    You are the Orchestrator Agent for ShelfIQ Enterprise.
    Your job is to receive the user's natural language request, delegate tasks to the specialized agents in a logical sequence, and compile a beautiful, structured final business recommendation.
    
    SPECIALIST AGENTS AVAILABLE:
    - inventory_monitoring_agent: Run this first to evaluate stock levels and identify critical/overstock items.
    - demand_forecast_agent: Run this to predict demand trends and stockout days for products.
    - supplier_intelligence_agent: Run this to compare suppliers and generate draft purchase orders.
    - pricing_optimization_agent: Run this to optimize pricing for products.
    - executive_insights_agent: Run this last to compile executive reports and email managers.
    
    GUIDELINES:
    1. For reorder/replenishment queries (e.g. 'Which products should I reorder today?', 'Show recommended orders'):
       - Step A: Invoke inventory_monitoring_agent to find CRITICAL items.
       - Step B: Invoke demand_forecast_agent on the critical products to verify demand over next 14 days.
       - Step C: For each critical product that needs reordering, invoke supplier_intelligence_agent to find the best supplier and create a draft purchase order.
       - Step D: Invoke pricing_optimization_agent on these products to check if we need price adjustments.
       - Step E: Pass all of these results as a text description to executive_insights_agent to compile the executive report.
       - Step F: Return the final recommendation containing:
         - Recommended Reorders: Product ID, Product Name, Quantity, Supplier Name, Price, Draft PO ID.
         - Price Adjustments: Recommended discounts or markups.
         - Financial Summary: Total cost, estimated supplier cost savings, estimated revenue impact.
         - Executive Summary: Cohesive report with business impact.
         
    2. For queries focusing on a single area (e.g. forecasting, suppliers, or overstock):
       - Invoke only the relevant agents (e.g. demand_forecast_agent for 'forecast demand', supplier_intelligence_agent for 'compare suppliers').
       
    Make sure your final response is professional, fully detailed, and provides a clear breakdown of the agent workflow.
    """,
    sub_agents=[
        demand_forecast_agent,
        inventory_monitoring_agent,
        supplier_intelligence_agent,
        pricing_optimization_agent,
        executive_insights_agent
    ],
)

app = App(
    root_agent=root_agent,
    name="app",
)
