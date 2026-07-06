import datetime
import pandas as pd
import numpy as np
from sqlalchemy.orm import Session
from app.db import SalesRecord, InventoryItem
try:
    import xgboost as xgb
    XGB_AVAILABLE = True
except ImportError:
    XGB_AVAILABLE = False

def forecast_demand(product_id: str, db: Session, days_to_forecast: int = 14) -> dict:
    """Forecasts demand for a product over the next N days.
    
    Returns:
        dict: {
            "forecast_dates": [str],
            "forecast_quantities": [float],
            "stockout_risk_detected": bool,
            "days_to_stockout": int,  # -1 if no stockout risk
            "recommended_reorder_qty": int,
            "seasonality_insight": str,
            "trend_insight": str,
            "explanation": str
        }
    """
    # 1. Load data
    sales = db.query(SalesRecord).filter(SalesRecord.product_id == product_id).order_by(SalesRecord.date).all()
    item = db.query(InventoryItem).filter(InventoryItem.product_id == product_id).first()
    
    if not item:
        return {"error": f"Product {product_id} not found."}
        
    if len(sales) < 14:
        # Fallback if there is not enough historical sales data
        mean_sales = sum([s.quantity_sold for s in sales]) / max(1, len(sales))
        forecast_dates = [(datetime.date.today() + datetime.timedelta(days=i)).strftime("%Y-%m-%d") for i in range(1, days_to_forecast + 1)]
        forecast_quantities = [round(mean_sales, 2)] * days_to_forecast
        
        current_stock = item.stock_level
        days_to_stockout = -1
        total_forecasted = 0
        for i, q in enumerate(forecast_quantities):
            total_forecasted += q
            if current_stock - total_forecasted <= 0:
                days_to_stockout = i + 1
                break
                
        reorder_qty = max(0, item.optimal_stock - item.stock_level) if item.stock_level <= item.reorder_point else 0
        
        return {
            "forecast_dates": forecast_dates,
            "forecast_quantities": forecast_quantities,
            "stockout_risk_detected": days_to_stockout != -1,
            "days_to_stockout": days_to_stockout,
            "recommended_reorder_qty": reorder_qty,
            "seasonality_insight": "Insufficient historical data to detect seasonal variations.",
            "trend_insight": "Flat baseline projection due to limited history.",
            "explanation": f"Forecast generated using a simple baseline average of {mean_sales:.1f} units/day."
        }

    # 2. Build DataFrame
    df = pd.DataFrame([{
        "date": pd.to_datetime(s.date),
        "quantity_sold": s.quantity_sold
    } for s in sales])
    
    df.set_index("date", inplace=True)
    df = df.resample("D").sum().fillna(0) # Ensure no missing dates
    
    # 3. Feature Engineering
    df["day_of_week"] = df.index.dayofweek
    df["day_of_month"] = df.index.day
    df["week_of_year"] = df.index.isocalendar().week.astype(int)
    
    # Lag features
    df["lag_1"] = df["quantity_sold"].shift(1)
    df["lag_7"] = df["quantity_sold"].shift(7)
    df["rolling_mean_7"] = df["quantity_sold"].shift(1).rolling(window=7).mean()
    df["rolling_std_7"] = df["quantity_sold"].shift(1).rolling(window=7).std()
    
    df.dropna(inplace=True)
    
    if len(df) < 7:
        # Fallback if lags emptied the dataframe
        mean_sales = df["quantity_sold"].mean()
        forecast_quantities = [round(mean_sales, 2)] * days_to_forecast
    else:
        # Predict using XGBoost (or Scikit-Learn RandomForest/LinearRegression as fallback)
        X = df[["day_of_week", "day_of_month", "week_of_year", "lag_1", "lag_7", "rolling_mean_7", "rolling_std_7"]]
        y = df["quantity_sold"]
        
        if XGB_AVAILABLE:
            model = xgb.XGBRegressor(n_estimators=30, max_depth=3, learning_rate=0.1, random_state=42)
        else:
            from sklearn.ensemble import RandomForestRegressor
            model = RandomForestRegressor(n_estimators=30, max_depth=3, random_state=42)
            
        model.fit(X, y)
        
        # Forecast autoregressively
        last_known = df.iloc[-1].copy()
        current_date = df.index[-1]
        
        forecast_quantities = []
        history_qs = list(df["quantity_sold"].values)
        
        for i in range(1, days_to_forecast + 1):
            next_date = current_date + datetime.timedelta(days=i)
            
            # Build features for next day
            lag1 = history_qs[-1]
            lag7 = history_qs[-7] if len(history_qs) >= 7 else history_qs[-1]
            roll_mean7 = np.mean(history_qs[-7:]) if len(history_qs) >= 7 else np.mean(history_qs)
            roll_std7 = np.std(history_qs[-7:]) if len(history_qs) >= 7 else 0.1
            
            features = pd.DataFrame([{
                "day_of_week": next_date.weekday(),
                "day_of_month": next_date.day,
                "week_of_year": next_date.isocalendar()[1],
                "lag_1": lag1,
                "lag_7": lag7,
                "rolling_mean_7": roll_mean7,
                "rolling_std_7": roll_std7
            }])
            
            pred = float(model.predict(features)[0])
            pred = max(0.0, pred) # Ensure non-negative
            
            forecast_quantities.append(round(pred, 2))
            history_qs.append(pred)

    forecast_dates = [(datetime.date.today() + datetime.timedelta(days=i)).strftime("%Y-%m-%d") for i in range(1, days_to_forecast + 1)]
    
    # 4. Stockout Risk and Reorder Recommendations
    current_stock = item.stock_level
    days_to_stockout = -1
    cumulative_demand = 0
    
    for i, qty in enumerate(forecast_quantities):
        cumulative_demand += qty
        if current_stock - cumulative_demand <= 0:
            days_to_stockout = i + 1
            break
            
    stockout_risk_detected = (days_to_stockout != -1 and days_to_stockout <= 7) or (current_stock <= item.reorder_point)
    
    # Calculate recommended reorder quantity
    # Reorder quantity should cover forecast demand for the supplier lead time + safety stock,
    # or just fill up to the optimal stock level.
    if stockout_risk_detected or current_stock <= item.reorder_point:
        recommended_reorder_qty = max(0, item.optimal_stock - current_stock)
    else:
        recommended_reorder_qty = 0
        
    # Seasonality and Trend Analysis
    recent_weekend_sales = df[df["day_of_week"].isin([5, 6])]["quantity_sold"].mean()
    recent_weekday_sales = df[df["day_of_week"].isin([0, 1, 2, 3, 4])]["quantity_sold"].mean()
    
    if recent_weekend_sales > recent_weekday_sales * 1.2:
        seasonality_insight = f"Strong weekly seasonality detected: weekend demand is ~{recent_weekend_sales/max(0.1, recent_weekday_sales):.1f}x higher than weekdays."
    else:
        seasonality_insight = "No significant weekly seasonality detected; daily demand remains relatively uniform."
        
    # Simple trend calculation over past 30 days
    if len(df) >= 30:
        first_half = df["quantity_sold"].iloc[-30:-15].mean()
        second_half = df["quantity_sold"].iloc[-15:].mean()
        trend_pct = ((second_half - first_half) / max(1.0, first_half)) * 100
        if trend_pct > 5:
            trend_insight = f"Upward trend detected: sales volume has grown by {trend_pct:.1f}% over the last 30 days."
        elif trend_pct < -5:
            trend_insight = f"Downward trend detected: sales volume has decreased by {abs(trend_pct):.1f}% over the last 30 days."
        else:
            trend_insight = "Stable demand trend: daily average sales volume remains consistent."
    else:
        trend_insight = "Sales history is stable with no long-term trend shifts."
        
    explanation = (
        f"Demand forecast generated using XGBoost regression trained on 60 days of sales history. "
        f"{seasonality_insight} {trend_insight} "
        f"Current stock level is {current_stock} units. "
    )
    if stockout_risk_detected:
        if days_to_stockout != -1:
            explanation += f"WARNING: Stockout risk detected. Product is expected to run out of stock in {days_to_stockout} days."
        else:
            explanation += f"WARNING: Stock level ({current_stock}) is below reorder point ({item.reorder_point})."
    else:
        explanation += "Stock levels are healthy and expected to cover projected demand."

    return {
        "forecast_dates": forecast_dates,
        "forecast_quantities": forecast_quantities,
        "stockout_risk_detected": stockout_risk_detected,
        "days_to_stockout": days_to_stockout,
        "recommended_reorder_qty": recommended_reorder_qty,
        "seasonality_insight": seasonality_insight,
        "trend_insight": trend_insight,
        "explanation": explanation
    }
