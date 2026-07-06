import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Package,
  ShieldCheck,
  FileText,
  Check,
  X,
  RefreshCw,
  AlertTriangle,
  TrendingUp,
  DollarSign,
  LogOut,
  ShieldAlert,
  User,
  ArrowRight,
  Info,
  Layers,
  Plus,
  Trash2
} from 'lucide-react';

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title as ChartTitle,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ChartTitle,
  Tooltip,
  Legend,
  Filler
);

const API_BASE = "http://localhost:8000";

interface UserProfile {
  email: string;
  role: string;
  name: string;
}

interface InventoryItem {
  product_id: string;
  name: string;
  category: string;
  stock_level: number;
  reorder_point: number;
  optimal_stock: number;
  unit_cost: number;
  unit_price: number;
  health_score: number;
  status_label: string;
}

interface Supplier {
  supplier_id: string;
  name: string;
  lead_time_days: number;
  reliability_score: number;
  catalog: { product_id: string; product_name: string; price: number }[];
}

interface PurchaseOrder {
  id: number;
  product_id: string;
  product_name: string;
  quantity: number;
  supplier_name: string;
  supplier_id: string;
  status: string;
  created_at: string;
  approved_by?: string;
  approved_at?: string;
  total_cost: number;
}

interface AuditLog {
  id: number;
  timestamp: string;
  agent_name: string;
  action: string;
  user_role: string;
  details: string;
}

interface DashboardStats {
  inventory_health_score: number;
  stockout_risk_count: number;
  overstock_alerts_count: number;
  potential_savings: number;
  estimated_revenue_impact: number;
  recommended_orders: any[];
  total_reorder_cost: number;
}



export default function App() {
  // Auth state
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loginEmail, setLoginEmail] = useState('sarah@shelfiq.com');
  const [loginPassword, setLoginPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // App navigation
  const [activeTab, setActiveTab] = useState<'dashboard' | 'inventory' | 'orders' | 'logs'>('dashboard');

  // Business Data states
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loadingStats, setLoadingStats] = useState(false);

  // Forecasting details states
  const [selectedProductId, setSelectedProductId] = useState<string>('PROD003');
  const [forecastData, setForecastData] = useState<any | null>(null);
  const [loadingForecast, setLoadingForecast] = useState(false);

  // Custom Modals states
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustProductId, setAdjustProductId] = useState('');
  const [adjustCurrentStock, setAdjustCurrentStock] = useState(0);
  const [adjustNewStock, setAdjustNewStock] = useState(0);

  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [newProdId, setNewProdId] = useState('');
  const [newProdName, setNewProdName] = useState('');
  const [newProdCategory, setNewProdCategory] = useState('Beverages');
  const [newProdStock, setNewProdStock] = useState(10);
  const [newProdReorderPoint, setNewProdReorderPoint] = useState(5);
  const [newProdOptimalStock, setNewProdOptimalStock] = useState(30);
  const [newProdPrice, setNewProdPrice] = useState(1.99);
  const [newProdSupplierId, setNewProdSupplierId] = useState('SUP001');
  const [newProdSupplierPrice, setNewProdSupplierPrice] = useState(0.99);

  // Reorder Modal states
  const [showReorderModal, setShowReorderModal] = useState(false);
  const [reorderProductId, setReorderProductId] = useState('');
  const [reorderQuantity, setReorderQuantity] = useState(0);
  const [reorderSupplierId, setReorderSupplierId] = useState('');
  const [reorderProductName, setReorderProductName] = useState('');
  const [reorderSupplierName, setReorderSupplierName] = useState('');

  // Delete Confirm Modal states
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState('');
  const [deleteTargetName, setDeleteTargetName] = useState('');

  // Refresh lists helper
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Load user profile on token change
  useEffect(() => {
    if (token) {
      fetch(`${API_BASE}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => {
          if (!res.ok) throw new Error("Session expired");
          return res.json();
        })
        .then(data => {
          setUser(data);
        })
        .catch(() => {
          logout();
        });
    } else {
      setUser(null);
    }
  }, [token]);

  // Load business statistics
  useEffect(() => {
    if (!token) return;
    setLoadingStats(true);
    const headers = { 'Authorization': `Bearer ${token}` };
    
    Promise.all([
      fetch(`${API_BASE}/api/dashboard/stats`, { headers }).then(r => r.json()),
      fetch(`${API_BASE}/api/inventory`, { headers }).then(r => r.json()),
      fetch(`${API_BASE}/api/suppliers`, { headers }).then(r => r.json()),
      fetch(`${API_BASE}/api/orders`, { headers }).then(r => r.json()),
      fetch(`${API_BASE}/api/audit-logs`, { headers }).then(r => r.json())
    ])
      .then(([statsData, invData, suppData, ordData, logsData]) => {
        setStats(statsData);
        setInventory(invData);
        setSuppliers(suppData);
        setOrders(ordData);
        setAuditLogs(logsData);
        setLoadingStats(false);
      })
      .catch(err => {
        console.error("Failed to load business statistics", err);
        setLoadingStats(false);
      });
  }, [token, refreshTrigger]);

  // Load forecasting data when product selection changes
  useEffect(() => {
    if (!token || !selectedProductId) return;
    setLoadingForecast(true);
    fetch(`${API_BASE}/api/forecast/${selectedProductId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        setForecastData(data);
        setLoadingForecast(false);
      })
      .catch(err => {
        console.error("Forecast fetch failed", err);
        setLoadingForecast(false);
      });
  }, [token, selectedProductId, refreshTrigger]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: loginEmail, password: loginPassword })
    })
      .then(res => {
        if (!res.ok) return res.json().then(d => { throw new Error(d.detail || 'Login failed'); });
        return res.json();
      })
      .then(data => {
        localStorage.setItem('token', data.access_token);
        setToken(data.access_token);
      })
      .catch(err => {
        setAuthError(err.message || 'Invalid email or password.');
      });
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  };

  // Initiate reorder from recommendations
  const handleInitiateReorder = (prodId: string, prodName: string, qty: number, suppId: string, suppName: string) => {
    setReorderProductId(prodId);
    setReorderProductName(prodName);
    setReorderQuantity(qty);
    setReorderSupplierId(suppId);
    setReorderSupplierName(suppName);
    setShowReorderModal(true);
  };

  // Submit PO to backend
  const submitReorder = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          product_id: reorderProductId,
          quantity: reorderQuantity,
          supplier_id: reorderSupplierId
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Server error ${res.status}`);
      }
      const data = await res.json();
      setShowReorderModal(false);
      setRefreshTrigger(p => p + 1);
      setActiveTab('orders');
      alert(`✅ Order confirmed! PO #${data.po_id} created with status "Reordered". It now appears in Order Approvals.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create PO.';
      alert('❌ ' + msg);
    }
  };

  // Approve or Reject purchase order
  const handleApprovePO = (poId: number, approve: boolean) => {
    if (!token) return;
    fetch(`${API_BASE}/api/orders/${poId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ approved: approve })
    })
      .then(res => res.json())
      .then(() => {
        setRefreshTrigger(p => p + 1);
      })
      .catch(err => {
        alert("Failed to update purchase order status: " + err.message);
      });
  };

  // Open manual stock adjustment modal
  const handleUpdateStock = (prodId: string, currentVal: number) => {
    setAdjustProductId(prodId);
    setAdjustCurrentStock(currentVal);
    setAdjustNewStock(currentVal);
    setShowAdjustModal(true);
  };

  // Submit manual stock adjustment
  const submitStockAdjustment = () => {
    if (!token) return;
    
    fetch(`${API_BASE}/api/inventory/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ product_id: adjustProductId, new_stock: adjustNewStock })
    })
      .then(res => {
        if (!res.ok) throw new Error("Warehouse Manager role required.");
        return res.json();
      })
      .then(() => {
        setShowAdjustModal(false);
        setRefreshTrigger(p => p + 1);
      })
      .catch(err => {
        alert(err.message || "Failed to update stock.");
      });
  };

  // Remove product — opens inline confirm modal (window.confirm blocked in embedded browsers)
  const handleDeleteProduct = (prodId: string, prodName: string) => {
    setDeleteTargetId(prodId);
    setDeleteTargetName(prodName);
    setShowDeleteModal(true);
  };

  const confirmDeleteProduct = async () => {
    if (!token) return;
    setShowDeleteModal(false);
    try {
      const res = await fetch(`${API_BASE}/api/inventory/${deleteTargetId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Server error ${res.status}`);
      }
      setRefreshTrigger(p => p + 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to remove product.';
      alert('❌ ' + msg);
    }
  };

  // Add new product
  const submitAddProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    
    fetch(`${API_BASE}/api/inventory/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        product_id: newProdId,
        name: newProdName,
        category: newProdCategory,
        stock_level: newProdStock,
        reorder_point: newProdReorderPoint,
        optimal_stock: newProdOptimalStock,
        unit_price: newProdPrice,
        supplier_id: newProdSupplierId,
        supplier_price: newProdSupplierPrice
      })
    })
      .then(res => {
        if (!res.ok) throw new Error("Warehouse Manager role required.");
        return res.json();
      })
      .then(() => {
        setShowAddProductModal(false);
        // Clear inputs
        setNewProdId('');
        setNewProdName('');
        setNewProdStock(10);
        setNewProdReorderPoint(5);
        setNewProdOptimalStock(30);
        setNewProdPrice(1.99);
        setNewProdSupplierPrice(0.99);
        
        alert("Product added successfully.");
        setRefreshTrigger(p => p + 1);
      })
      .catch(err => {
        alert(err.message || "Failed to add product.");
      });
  };

  // Helper to get role badge styling
  const getRoleBadge = (roleName: string) => {
    switch (roleName) {
      case 'Admin': return 'badge-admin';
      case 'Store Manager': return 'badge-manager';
      case 'Warehouse Manager': return 'badge-warehouse';
      case 'Finance': return 'badge-finance';
      default: return 'badge-regular';
    }
  };

  // Render Login Portal if not authenticated
  if (!token) {
    return (
      <div className="login-container">
        <div className="login-glass-card">
          <div className="login-header">
            <div className="logo-glow">
              <Layers className="logo-icon animate-pulse" size={40} />
            </div>
            <h1>ShelfIQ Enterprise</h1>
            <p>AI-Powered Multi-Agent Inventory Intelligence</p>
          </div>
          
          <form onSubmit={handleLogin} className="login-form">
            {authError && <div className="login-error"><ShieldAlert size={18} /> {authError}</div>}
            
            <div className="form-group">
              <label>Work Email</label>
              <input 
                type="email" 
                value={loginEmail} 
                onChange={e => setLoginEmail(e.target.value)} 
                required 
                placeholder="name@shelfiq.com"
              />
            </div>

            <div className="form-group">
              <label>Password</label>
              <input 
                type="password" 
                value={loginPassword} 
                onChange={e => setLoginPassword(e.target.value)} 
                required 
                placeholder="Enter your password"
              />
            </div>
            
            <button type="submit" className="login-btn">
              <span>Access Command Center</span>
              <ArrowRight size={18} />
            </button>
          </form>

          {/* Demo Accounts Hint */}
          <div style={{ marginTop: '20px', padding: '14px 16px', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: '10px' }}>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Demo Accounts</p>
            <div style={{ display: 'grid', gap: '5px' }}>
              {[
                { email: 'admin@shelfiq.com',   pass: 'Admin@123',   role: 'Admin — All Stores',          color: '#f59e0b' },
                { email: 'sarah@shelfiq.com',   pass: 'Sarah@123',   role: 'Store Manager — Downtown',     color: '#6366f1' },
                { email: 'mike@shelfiq.com',    pass: 'Mike@123',    role: 'Warehouse Mgr — North Warehouse', color: '#10b981' },
                { email: 'lisa@shelfiq.com',    pass: 'Lisa@123',    role: 'Finance — Downtown',           color: '#ec4899' },
              ].map(u => (
                <button key={u.email} type="button"
                  onClick={() => { setLoginEmail(u.email); setLoginPassword(u.pass); }}
                  style={{ textAlign: 'left', background: 'transparent', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <span style={{ fontSize: '12px', color: '#cbd5e1' }}>{u.email}</span>
                  <span style={{ fontSize: '10px', color: u.color, fontWeight: 600 }}>{u.role}</span>
                </button>
              ))}
            </div>
          </div>
          
          <div className="login-footer">
            <p>Secure Enterprise Portal. Protected by Role-Based Access Controls.</p>
          </div>
        </div>
        
        <style>{`
          .login-container {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 20px;
          }
          .login-glass-card {
            background: rgba(15, 23, 42, 0.7);
            backdrop-filter: blur(15px);
            border: 1px solid rgba(139, 92, 246, 0.15);
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.5), 0 0 30px rgba(139, 92, 246, 0.05);
            border-radius: 20px;
            padding: 40px;
            width: 100%;
            max-width: 480px;
            animation: fadeIn 0.5s ease-out;
          }
          .login-header {
            text-align: center;
            margin-bottom: 30px;
          }
          .logo-glow {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 70px;
            height: 70px;
            background: radial-gradient(circle, rgba(139, 92, 246, 0.2) 0%, transparent 70%);
            border-radius: 50%;
            margin-bottom: 15px;
          }
          .logo-icon {
            color: #a78bfa;
            filter: drop-shadow(0 0 8px rgba(167, 139, 250, 0.5));
          }
          .login-header h1 {
            font-size: 28px;
            font-weight: 700;
            color: #f8fafc;
            margin-bottom: 6px;
          }
          .login-header p {
            font-size: 14px;
            color: #94a3b8;
          }
          .login-form {
            display: flex;
            flex-direction: column;
            gap: 20px;
          }
          .form-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
          }
          .form-group label {
            font-size: 13px;
            font-weight: 500;
            color: #cbd5e1;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .form-group input, .form-group select {
            background: rgba(30, 41, 59, 0.5);
            border: 1px solid rgba(148, 163, 184, 0.15);
            border-radius: 8px;
            padding: 12px;
            color: #f8fafc;
            font-size: 15px;
            transition: all 0.3s;
          }
          .form-group input:focus, .form-group select:focus {
            border-color: #a78bfa;
            box-shadow: 0 0 10px rgba(167, 139, 250, 0.15);
            outline: none;
          }
          .login-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%);
            border: none;
            border-radius: 8px;
            padding: 14px;
            color: #ffffff;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
            box-shadow: 0 4px 15px rgba(139, 92, 246, 0.3);
            margin-top: 10px;
          }
          .login-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(139, 92, 246, 0.5);
          }
          .login-error {
            display: flex;
            align-items: center;
            gap: 8px;
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.2);
            border-radius: 8px;
            padding: 12px;
            color: #f87171;
            font-size: 14px;
          }
          .login-footer {
            margin-top: 30px;
            text-align: center;
            font-size: 11px;
            color: #64748b;
          }
        `}</style>
      </div>
    );
  }

  // Formatting chart data for demand forecast
  const chartLabels = forecastData ? forecastData.forecast_dates : [];
  const chartDataPoints = forecastData ? forecastData.forecast_quantities : [];
  
  const chartConfig = {
    labels: chartLabels,
    datasets: [
      {
        label: 'Projected Daily Demand',
        data: chartDataPoints,
        borderColor: '#a78bfa',
        backgroundColor: 'rgba(167, 139, 250, 0.15)',
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#a78bfa',
        pointBorderColor: '#ffffff',
        pointHoverRadius: 6,
        borderWidth: 2,
        borderDash: [0, 0],
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        callbacks: {
          label: (context: any) => `Demand: ${context.parsed.y} units`
        }
      }
    },
    scales: {
      y: {
        grid: {
          color: 'rgba(255, 255, 255, 0.05)'
        },
        ticks: {
          color: '#94a3b8'
        }
      },
      x: {
        grid: {
          display: false
        },
        ticks: {
          color: '#94a3b8'
        }
      }
    }
  };

  return (
    <div className="dashboard-container">
      {/* 1. Header */}
      <header className="header-glass">
        <div className="brand">
          <Layers className="brand-logo" />
          <div className="brand-texts">
            <h2>ShelfIQ</h2>
            <span>Enterprise Intelligence</span>
          </div>
          <span className="brand-badge-ai">AI Operations</span>
        </div>
        
        <div className="user-profile-controls">
          <div className="profile-details">
            <div className="avatar-placeholder">
              <User size={16} />
            </div>
            <div className="profile-texts">
              <span className="profile-name">{user?.name}</span>
              <span className={`profile-role ${getRoleBadge(user?.role || '')}`}>{user?.role}</span>
            </div>
          </div>
          <button className="logout-btn" onClick={logout} title="Sign Out">
            <LogOut size={18} />
          </button>
        </div>
      </header>
      
      <div className="workspace">
        {/* 2. Sidebar Navigation */}
        <aside className="sidebar-glass">
          <nav className="nav-menu">
            <button 
              className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} 
              onClick={() => setActiveTab('dashboard')}
            >
              <LayoutDashboard size={20} />
              <span>Executive Dashboard</span>
            </button>
            
            <button 
              className={`nav-item ${activeTab === 'inventory' ? 'active' : ''}`} 
              onClick={() => setActiveTab('inventory')}
            >
              <Package size={20} />
              <span>Inventory Directory</span>
            </button>
            

            
            <button 
              className={`nav-item ${activeTab === 'orders' ? 'active' : ''}`} 
              onClick={() => setActiveTab('orders')}
            >
              <ShieldCheck size={20} />
              <span>Order Approvals</span>
              {orders.filter(o => o.status === 'pending_approval' || o.status === 'reordered').length > 0 && (
                <span className="badge-count-pending">
                  {orders.filter(o => o.status === 'pending_approval' || o.status === 'reordered').length}
                </span>
              )}
            </button>
            
            <button 
              className={`nav-item ${activeTab === 'logs' ? 'active' : ''}`} 
              onClick={() => setActiveTab('logs')}
            >
              <FileText size={20} />
              <span>Audit Trail Logs</span>
            </button>
          </nav>
          
          <div className="sidebar-footer">
            <div className="status-indicator">
              <span className="dot dot-green"></span>
              <span>Platform Core Active</span>
            </div>
            <div className="status-indicator" style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
              <span>Suppliers Linked: {suppliers.length}</span>
            </div>
          </div>
        </aside>
        
        {/* 3. Main Workspace Area */}
        <main className="content-area">
          {loadingStats && (
            <div className="page-loader">
              <RefreshCw className="animate-spin" size={24} />
              <span>Syncing ShelfIQ Core Engine...</span>
            </div>
          )}
          
          {/* TAB 1: EXECUTIVE DASHBOARD */}
          {activeTab === 'dashboard' && stats && (
            <div className="dashboard-grid fade-in">
              <div className="stats-row">
                {/* Stat 1: Health Score */}
                <div className="stat-card">
                  <div className="stat-card-header">
                    <span>Inventory Health</span>
                    <TrendingUp className="stat-icon-purple" size={18} />
                  </div>
                  <div className="stat-card-body">
                    <div className="health-gauge">
                      <div className="health-gauge-inner">
                        <span className="health-gauge-number">{stats.inventory_health_score}%</span>
                        <span className="health-gauge-label">Average</span>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Stat 2: Stockout Risks */}
                <div className="stat-card">
                  <div className="stat-card-header">
                    <span>Stockout Risks</span>
                    <AlertTriangle className="stat-icon-red" size={18} />
                  </div>
                  <div className="stat-card-body">
                    <span className="huge-number text-red">{stats.stockout_risk_count}</span>
                    <span className="subtext-label">Products Critical Level</span>
                  </div>
                </div>
                
                {/* Stat 3: Overstock Alerts */}
                <div className="stat-card">
                  <div className="stat-card-header">
                    <span>Overstock Alerts</span>
                    <ShieldAlert className="stat-icon-amber" size={18} />
                  </div>
                  <div className="stat-card-body">
                    <span className="huge-number text-amber">{stats.overstock_alerts_count}</span>
                    <span className="subtext-label">Products Excess Stock</span>
                  </div>
                </div>
                
                {/* Stat 4: Potential Cost Savings */}
                <div className="stat-card">
                  <div className="stat-card-header">
                    <span>Cost Savings</span>
                    <DollarSign className="stat-icon-green" size={18} />
                  </div>
                  <div className="stat-card-body">
                    <span className="huge-number text-green">${stats.potential_savings.toLocaleString()}</span>
                    <span className="subtext-label">Via Supplier Optimization</span>
                  </div>
                </div>
              </div>
              
              <div className="grid-split">
                {/* Left: Reorder Recommendations */}
                <div className="panel recommendations-panel">
                  <div className="panel-header">
                    <h3>AI-Recommended replenishment orders</h3>
                    <span className="info-tag-purple">Human-in-the-Loop Required</span>
                  </div>
                  
                  {stats.recommended_orders.length === 0 ? (
                    <div className="empty-panel">
                      <Check className="check-success" size={40} />
                      <p>All stock levels are optimal. No reorders needed today.</p>
                    </div>
                  ) : (
                    <div className="table-responsive">
                      <table className="custom-table">
                        <thead>
                          <tr>
                            <th>Product</th>
                            <th>Qty</th>
                            <th>Optimal Supplier</th>
                            <th>Lead Time</th>
                            <th>Cost</th>
                            <th>Savings</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats.recommended_orders.map((rec) => (
                            <tr key={rec.product_id}>
                              <td>
                                <div className="product-cell-name">
                                  <strong>{rec.product_name}</strong>
                                  <span>{rec.product_id}</span>
                                </div>
                              </td>
                              <td>{rec.reorder_quantity}</td>
                              <td>
                                <div className="supplier-cell">
                                  <span>{rec.recommended_supplier_name}</span>
                                </div>
                              </td>
                              <td>{rec.lead_time_days} days</td>
                              <td>${rec.total_cost.toFixed(2)}</td>
                              <td className="text-green">+${rec.estimated_savings.toFixed(2)}</td>
                              <td>
                                <button 
                                  className="action-btn-reorder"
                                  onClick={() => handleInitiateReorder(rec.product_id, rec.product_name, rec.reorder_quantity, rec.supplier_id, rec.recommended_supplier_name)}
                                >
                                  <span>Reorder</span>
                                  <ArrowRight size={14} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                
                {/* Right: Demand Forecasting Interactive Line Graph */}
                <div className="panel forecast-panel">
                  <div className="panel-header">
                    <h3>XGBoost Demand Forecaster</h3>
                    <select 
                      className="product-select"
                      value={selectedProductId}
                      onChange={e => setSelectedProductId(e.target.value)}
                    >
                      {inventory.map(i => (
                        <option key={i.product_id} value={i.product_id}>{i.name}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="panel-body">
                    {loadingForecast ? (
                      <div className="loader-placeholder">
                        <RefreshCw className="animate-spin" size={24} />
                        <span>Re-calculating forecast model...</span>
                      </div>
                    ) : forecastData ? (
                      <div className="forecast-chart-container">
                        <div className="chart-canvas-wrapper">
                          <Line data={chartConfig} options={chartOptions} />
                        </div>
                        
                        <div className="forecast-summary-card">
                          <div className="summary-stat-row">
                            <div className="sub-stat">
                              <span>Days to Stockout</span>
                              <strong className={forecastData.days_to_stockout !== -1 ? 'text-red' : 'text-green'}>
                                {forecastData.days_to_stockout !== -1 ? `${forecastData.days_to_stockout} Days` : 'Healthy'}
                              </strong>
                            </div>
                            <div className="sub-stat">
                              <span>Suggested Reorder</span>
                              <strong>{forecastData.recommended_reorder_qty} units</strong>
                            </div>
                          </div>
                          
                          <div className="forecast-explanation">
                            <Info size={16} className="text-purple shrink-0" />
                            <p>{forecastData.explanation}</p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="empty-panel">No forecasting details available.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {/* TAB 2: INVENTORY DIRECTORY */}
          {activeTab === 'inventory' && (
            <div className="inventory-view fade-in">
              <div className="panel-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                  <h2>Product Inventory Levels</h2>
                  <span className="total-indicator">{inventory.length} Total Items</span>
                </div>
                <button className="btn-primary" onClick={() => setShowAddProductModal(true)} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', border: 'none', background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)', color: '#fff', fontSize: '13px', fontWeight: '600', boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)' }}>
                  <Plus size={16} />
                  <span>Add New Product</span>
                </button>
              </div>
              
              <div className="inventory-grid">
                {inventory.map(item => (
                  <div className={`inventory-card ${item.status_label.toLowerCase()}-card`} key={item.product_id}>
                    <div className="card-top">
                      <div className="card-title-grp">
                        <h3>{item.name}</h3>
                        <span className="item-category">{item.category} • {item.product_id}</span>
                      </div>
                      <span className={`status-badge status-${item.status_label.toLowerCase()}`}>
                        {item.status_label}
                      </span>
                    </div>
                    
                    <div className="card-metrics">
                      <div className="metric">
                        <span>Current Stock</span>
                        <strong className={item.stock_level < item.reorder_point ? 'text-red' : ''}>{item.stock_level}</strong>
                      </div>
                      <div className="metric">
                        <span>Optimal level</span>
                        <strong>{item.optimal_stock}</strong>
                      </div>
                      <div className="metric">
                        <span>Reorder Trigger</span>
                        <strong>{item.reorder_point}</strong>
                      </div>
                    </div>
                    
                    <div className="health-bar-container">
                      <div className="health-bar-label">
                        <span>Inventory Health Score</span>
                        <span>{item.health_score}%</span>
                      </div>
                      <div className="health-bar-bg">
                        <div 
                          className="health-bar-fill"
                          style={{ 
                            width: `${item.health_score}%`,
                            backgroundColor: item.health_score < 50 ? '#f87171' : item.health_score > 90 ? '#fbbf24' : '#34d399'
                          }}
                        ></div>
                      </div>
                    </div>
                    
                    <div className="card-actions">
                      <button 
                        className="card-action-btn"
                        onClick={() => {
                          setSelectedProductId(item.product_id);
                          setActiveTab('dashboard');
                        }}
                      >
                        Forecast Details
                      </button>
                      <button 
                        className="card-action-btn-adjust"
                        onClick={() => handleUpdateStock(item.product_id, item.stock_level)}
                      >
                        Adjust Stock Level
                      </button>
                      <button
                        onClick={() => handleDeleteProduct(item.product_id, item.name)}
                        style={{
                          padding: '7px 12px',
                          background: 'rgba(239,68,68,0.08)',
                          border: '1px solid rgba(239,68,68,0.25)',
                          borderRadius: '6px',
                          color: '#f87171',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.18)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.08)')}
                      >
                        <Trash2 size={12} />
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          

          
          {/* TAB 4: ORDER APPROVALS */}
          {activeTab === 'orders' && (
            <div className="orders-view fade-in">
              <div className="panel-header-row">
                <h2>Human-in-the-Loop Reorder Approvals</h2>
                <span className="total-indicator">{orders.filter(o => o.status === 'pending_approval' || o.status === 'reordered').length} Pending Validation</span>
              </div>
              
              <div className="orders-list">
                {orders.length === 0 ? (
                  <div className="panel empty-panel">
                    <Check size={40} className="text-green" />
                    <p>No purchase orders found.</p>
                  </div>
                ) : (
                  <div className="table-responsive panel">
                    <table className="custom-table">
                      <thead>
                        <tr>
                          <th>PO ID</th>
                          <th>Product</th>
                          <th>Quantity</th>
                          <th>Supplier Name</th>
                          <th>Total Cost</th>
                          <th>Status</th>
                          <th>Validation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map((po) => (
                          <tr key={po.id}>
                            <td><strong>PO#{po.id}</strong></td>
                            <td>
                              <div className="product-cell-name">
                                <strong>{po.product_name}</strong>
                                <span>{po.product_id}</span>
                              </div>
                            </td>
                            <td>{po.quantity}</td>
                            <td>{po.supplier_name}</td>
                            <td>${po.total_cost.toFixed(2)}</td>
                            <td>
                              <span className={`status-badge po-status-${po.status.toLowerCase()}`}>
                                {po.status.toUpperCase()}
                              </span>
                            </td>
                            <td>
                              {po.status === 'pending_approval' || po.status === 'reordered' ? (
                                <div className="po-actions">
                                  <button 
                                    className="po-approve-btn"
                                    onClick={() => handleApprovePO(po.id, true)}
                                  >
                                    <Check size={14} /> Approve
                                  </button>
                                  <button 
                                    className="po-reject-btn"
                                    onClick={() => handleApprovePO(po.id, false)}
                                  >
                                    <X size={14} /> Reject
                                  </button>
                                </div>
                              ) : (
                                <div className="po-validated-by">
                                  <span>By {po.approved_by || 'System'}</span>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* TAB 5: AUDIT LOGS */}
          {activeTab === 'logs' && (
            <div className="logs-view fade-in">
              <div className="panel-header-row">
                <h2>System Audit Logs & Decision Trails</h2>
                <span className="total-indicator">{auditLogs.length} Total Logs</span>
              </div>
              
              <div className="logs-timeline panel">
                <div className="table-responsive">
                  <table className="custom-table logs-table">
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>Agent / Trigger</th>
                        <th>Action</th>
                        <th>User Role</th>
                        <th>Decision Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map((log) => (
                        <tr key={log.id}>
                          <td className="log-time-cell">
                            {new Date(log.timestamp).toLocaleString()}
                          </td>
                          <td>
                            <strong className="log-agent-name">{log.agent_name}</strong>
                          </td>
                          <td>
                            <span className="log-action">{log.action}</span>
                          </td>
                          <td>
                            <span className={`profile-role ${getRoleBadge(log.user_role || '')}`}>
                              {log.user_role}
                            </span>
                          </td>
                          <td className="log-details-cell">{log.details}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
          {/* Custom Modal: Adjust Stock Level */}
          {showAdjustModal && (
            <div className="custom-modal-backdrop">
              <div className="custom-modal-card">
                <div className="modal-header">
                  <h3>Adjust Stock Level</h3>
                  <button className="close-btn" onClick={() => setShowAdjustModal(false)}><X size={18} /></button>
                </div>
                <div className="modal-body">
                  <p style={{ marginBottom: '16px', fontSize: '13px' }}>Adjusting stock for: <strong style={{ color: '#818cf8' }}>{adjustProductId}</strong></p>
                  <div className="form-group" style={{ marginBottom: '14px' }}>
                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>Current Stock Level</label>
                    <input type="text" value={adjustCurrentStock} disabled style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-muted)', outline: 'none' }} />
                  </div>
                  <div className="form-group">
                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>New Stock Level</label>
                    <input 
                      type="number" 
                      min="0"
                      value={adjustNewStock}
                      onChange={(e) => setAdjustNewStock(parseInt(e.target.value) || 0)}
                      style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-color)', outline: 'none' }}
                    />
                  </div>
                </div>
                <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: '20px' }}>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="btn-secondary" onClick={() => setShowAdjustModal(false)} style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-color)', cursor: 'pointer' }}>Cancel</button>
                    <button className="btn-primary" onClick={submitStockAdjustment} style={{ padding: '8px 16px', background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)', border: 'none', borderRadius: '6px', color: '#fff', fontWeight: '600', cursor: 'pointer' }}>Save Changes</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Custom Modal: Add New Product */}
          {showAddProductModal && (
            <div className="custom-modal-backdrop">
              <div className="custom-modal-card scrollable" style={{ maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto' }}>
                <div className="modal-header">
                  <h3>Add New Product</h3>
                  <button className="close-btn" onClick={() => setShowAddProductModal(false)}><X size={18} /></button>
                </div>
                <form onSubmit={submitAddProduct}>
                  <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginTop: '16px' }}>
                    <div className="form-group">
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>Product ID</label>
                      <input type="text" placeholder="e.g. PROD008" value={newProdId} onChange={e => setNewProdId(e.target.value)} required style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-color)', outline: 'none' }} />
                    </div>
                    <div className="form-group">
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>Product Name</label>
                      <input type="text" placeholder="e.g. Whole Grain Wheat" value={newProdName} onChange={e => setNewProdName(e.target.value)} required style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-color)', outline: 'none' }} />
                    </div>
                    <div className="form-group">
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>Category</label>
                      <select value={newProdCategory} onChange={e => setNewProdCategory(e.target.value)} style={{ width: '100%', padding: '10px', background: '#1e293b', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-color)', outline: 'none' }}>
                        <option value="Dairy">Dairy</option>
                        <option value="Bakery">Bakery</option>
                        <option value="Beverages">Beverages</option>
                        <option value="Produce">Produce</option>
                        <option value="Household">Household</option>
                        <option value="Baby">Baby</option>
                        <option value="Personal Care">Personal Care</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>Initial Stock</label>
                      <input type="number" min="0" value={newProdStock} onChange={e => setNewProdStock(parseInt(e.target.value) || 0)} required style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-color)', outline: 'none' }} />
                    </div>
                    <div className="form-group">
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>Reorder Point</label>
                      <input type="number" min="0" value={newProdReorderPoint} onChange={e => setNewProdReorderPoint(parseInt(e.target.value) || 0)} required style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-color)', outline: 'none' }} />
                    </div>
                    <div className="form-group">
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>Optimal Stock</label>
                      <input type="number" min="0" value={newProdOptimalStock} onChange={e => setNewProdOptimalStock(parseInt(e.target.value) || 0)} required style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-color)', outline: 'none' }} />
                    </div>
                    <div className="form-group">
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>Retail Price ($)</label>
                      <input type="number" step="0.01" min="0" value={newProdPrice} onChange={e => setNewProdPrice(parseFloat(e.target.value) || 0.0)} required style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-color)', outline: 'none' }} />
                    </div>
                    <div className="form-group">
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>Supplier</label>
                      <select value={newProdSupplierId} onChange={e => setNewProdSupplierId(e.target.value)} style={{ width: '100%', padding: '10px', background: '#1e293b', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-color)', outline: 'none' }}>
                        {suppliers.map(s => (
                          <option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ gridColumn: 'span 2' }}>
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>Wholesale Cost ($)</label>
                      <input type="number" step="0.01" min="0" value={newProdSupplierPrice} onChange={e => setNewProdSupplierPrice(parseFloat(e.target.value) || 0.0)} required style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-color)', outline: 'none' }} />
                    </div>
                  </div>
                  <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '24px' }}>
                    <button type="button" className="btn-secondary" onClick={() => setShowAddProductModal(false)} style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-color)', cursor: 'pointer' }}>Cancel</button>
                    <button type="submit" className="btn-primary" style={{ padding: '8px 16px', background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)', border: 'none', borderRadius: '6px', color: '#fff', fontWeight: '600', cursor: 'pointer' }}>Add Product</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Custom Modal: Confirm Reorder Quantity */}
          {showReorderModal && (
            <div className="custom-modal-backdrop">
              <div className="custom-modal-card">
                <div className="modal-header">
                  <h3>Confirm Reorder Request</h3>
                  <button className="close-btn" onClick={() => setShowReorderModal(false)}><X size={18} /></button>
                </div>
                <div className="modal-body">
                  <p style={{ marginBottom: '16px', fontSize: '13px' }}>
                    Reordering for: <strong style={{ color: '#818cf8' }}>{reorderProductName} ({reorderProductId})</strong>
                  </p>
                  
                  <div className="form-group" style={{ marginBottom: '14px' }}>
                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>Recommended Supplier</label>
                    <input type="text" value={reorderSupplierName} disabled style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-muted)', outline: 'none' }} />
                  </div>
                  
                  <div className="form-group">
                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>Reorder Quantity (Units)</label>
                    <input 
                      type="number" 
                      min="1"
                      value={reorderQuantity}
                      onChange={(e) => setReorderQuantity(parseInt(e.target.value) || 0)}
                      required
                      style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-color)', outline: 'none' }}
                    />
                  </div>
                </div>
                <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '24px' }}>
                  <button className="btn-secondary" onClick={() => setShowReorderModal(false)} style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-color)', cursor: 'pointer' }}>Cancel</button>
                  <button className="btn-primary" onClick={submitReorder} style={{ padding: '8px 16px', background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)', border: 'none', borderRadius: '6px', color: '#fff', fontWeight: '600', cursor: 'pointer' }}>Confirm Order</button>
                </div>
              </div>
            </div>
          )}

          {/* Delete Product Confirm Modal */}
          {showDeleteModal && (
            <div className="custom-modal-backdrop">
              <div className="custom-modal-card" style={{ maxWidth: '420px' }}>
                <div className="modal-header">
                  <h3 style={{ color: '#f87171', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Trash2 size={18} /> Remove Product
                  </h3>
                  <button className="close-btn" onClick={() => setShowDeleteModal(false)}><X size={18} /></button>
                </div>
                <div className="modal-body" style={{ padding: '20px 0' }}>
                  <p style={{ fontSize: '14px', color: 'var(--text-color)', marginBottom: '8px' }}>
                    Are you sure you want to remove:
                  </p>
                  <p style={{ fontSize: '15px', fontWeight: 700, color: '#f87171', marginBottom: '12px' }}>
                    {deleteTargetName}
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 400, marginLeft: '8px' }}>({deleteTargetId})</span>
                  </p>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '10px 12px', background: 'rgba(239,68,68,0.06)', borderRadius: '6px', border: '1px solid rgba(239,68,68,0.15)' }}>
                    ⚠️ This will permanently delete the product and all its sales history from the database.
                  </p>
                </div>
                <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
                  <button onClick={() => setShowDeleteModal(false)} style={{ padding: '8px 18px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-color)', cursor: 'pointer', fontWeight: 500 }}>Cancel</button>
                  <button onClick={confirmDeleteProduct} style={{ padding: '8px 18px', background: 'linear-gradient(135deg, #ef4444, #b91c1c)', border: 'none', borderRadius: '6px', color: '#fff', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Trash2 size={14} /> Yes, Remove
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
      
      {/* Dynamic Scoped CSS for the Premium Aesthetic Layout */}
      <style>{`
        /* Workspace layout */
        .dashboard-container {
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow: hidden;
        }
        
        /* Header glassmorphism */
        .header-glass {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 30px;
          background: rgba(15, 23, 42, 0.45);
          backdrop-filter: blur(10px);
          border-bottom: 1px solid var(--border-color);
          z-index: 100;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .brand-logo {
          color: var(--accent-purple);
          filter: drop-shadow(0 0 8px rgba(167, 139, 250, 0.4));
        }
        .brand-texts h2 {
          font-size: 18px;
          font-weight: 700;
          color: var(--text-primary);
        }
        .brand-texts span {
          font-size: 11px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .brand-badge-ai {
          background: rgba(139, 92, 246, 0.1);
          border: 1px solid rgba(139, 92, 246, 0.2);
          border-radius: 20px;
          padding: 3px 10px;
          font-size: 11px;
          font-weight: 500;
          color: var(--accent-purple);
          margin-left: 15px;
        }
        .user-profile-controls {
          display: flex;
          align-items: center;
          gap: 20px;
        }
        .profile-details {
          display: flex;
          align-items: center;
          gap: 10px;
          padding-right: 15px;
          border-right: 1px solid var(--border-color);
        }
        .avatar-placeholder {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--bg-tertiary);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-secondary);
        }
        .profile-texts {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 2px;
        }
        .profile-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .profile-role {
          font-size: 10px;
          font-weight: 600;
          padding: 2px 6px;
          border-radius: 4px;
          text-transform: uppercase;
        }
        .badge-admin { background: rgba(248, 113, 113, 0.1); color: var(--accent-red); border: 1px solid rgba(248, 113, 113, 0.2); }
        .badge-manager { background: rgba(167, 139, 250, 0.1); color: var(--accent-purple); border: 1px solid rgba(167, 139, 250, 0.2); }
        .badge-warehouse { background: rgba(56, 189, 248, 0.1); color: var(--accent-blue); border: 1px solid rgba(56, 189, 248, 0.2); }
        .badge-finance { background: rgba(52, 211, 153, 0.1); color: var(--accent-green); border: 1px solid rgba(52, 211, 153, 0.2); }
        .logout-btn {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          transition: color 0.2s;
        }
        .logout-btn:hover {
          color: var(--accent-red);
        }
        
        /* Sidebar Layout */
        .workspace {
          display: flex;
          flex: 1;
          overflow: hidden;
        }
        .sidebar-glass {
          width: 260px;
          background: rgba(15, 23, 42, 0.25);
          border-right: 1px solid var(--border-color);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 20px 0;
        }
        .nav-menu {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 0 14px;
        }
        .nav-item {
          display: flex;
          align-items: center;
          gap: 12px;
          background: transparent;
          border: none;
          border-radius: 8px;
          padding: 12px 16px;
          color: var(--text-secondary);
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          width: 100%;
          text-align: left;
        }
        .nav-item:hover {
          background: rgba(255, 255, 255, 0.03);
          color: var(--text-primary);
        }
        .nav-item.active {
          background: rgba(139, 92, 246, 0.08);
          border: 1px solid rgba(139, 92, 246, 0.15);
          color: var(--text-primary);
          box-shadow: inset 0 0 10px rgba(139, 92, 246, 0.05);
        }
        .badge-count-pending {
          background: var(--accent-red);
          color: #ffffff;
          font-size: 11px;
          font-weight: 600;
          padding: 1px 6px;
          border-radius: 10px;
          margin-left: auto;
        }
        .pulsing-dot {
          width: 8px;
          height: 8px;
          background-color: var(--accent-purple);
          border-radius: 50%;
          margin-left: auto;
          box-shadow: 0 0 8px var(--accent-purple);
          animation: pulse-glow 1.5s infinite;
        }
        .sidebar-footer {
          padding: 0 24px;
        }
        .status-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--text-secondary);
        }
        .dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }
        .dot-green {
          background-color: var(--accent-green);
          box-shadow: 0 0 8px var(--accent-green);
        }
        
        /* Main workspace content */
        .content-area {
          flex: 1;
          padding: 30px;
          overflow-y: auto;
          position: relative;
        }
        .page-loader {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(7, 11, 19, 0.85);
          backdrop-filter: blur(5px);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 15px;
          z-index: 50;
        }
        .page-loader span {
          font-size: 14px;
          color: var(--text-secondary);
        }
        
        /* Stat Cards */
        .stats-row {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }
        .stat-card {
          background: var(--bg-card);
          backdrop-filter: blur(10px);
          border: 1px solid var(--border-color);
          border-radius: 14px;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          transition: transform 0.3s, border-color 0.3s;
          box-shadow: var(--shadow-card);
        }
        .stat-card:hover {
          transform: translateY(-2px);
          border-color: rgba(139, 92, 246, 0.15);
        }
        .stat-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 13px;
          color: var(--text-secondary);
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .huge-number {
          font-size: 32px;
          font-weight: 700;
        }
        .subtext-label {
          font-size: 12px;
          color: var(--text-muted);
        }
        .text-red { color: var(--accent-red); filter: drop-shadow(0 0 5px rgba(248, 113, 113, 0.2)); }
        .text-amber { color: var(--accent-amber); filter: drop-shadow(0 0 5px rgba(251, 191, 36, 0.2)); }
        .text-green { color: var(--accent-green); filter: drop-shadow(0 0 5px rgba(52, 211, 153, 0.2)); }
        .text-purple { color: var(--accent-purple); }
        .stat-icon-purple { color: var(--accent-purple); }
        .stat-icon-red { color: var(--accent-red); }
        .stat-icon-amber { color: var(--accent-amber); }
        .stat-icon-green { color: var(--accent-green); }
        
        /* Health score circular gauge */
        .health-gauge {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 5px 0;
        }
        .health-gauge-inner {
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .health-gauge-number {
          font-size: 32px;
          font-weight: 800;
          color: var(--accent-green);
          filter: drop-shadow(0 0 10px rgba(52, 211, 153, 0.3));
        }
        .health-gauge-label {
          font-size: 11px;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        
        /* Layout Split Panels */
        .grid-split {
          display: grid;
          grid-template-columns: 1.3fr 1fr;
          gap: 25px;
        }
        @media(max-width: 1024px) {
          .grid-split { grid-template-columns: 1fr; }
        }
        .panel {
          background: var(--bg-card);
          backdrop-filter: blur(10px);
          border: 1px solid var(--border-color);
          border-radius: 14px;
          padding: 24px;
          box-shadow: var(--shadow-card);
          animation: fadeIn 0.3s ease-out;
        }
        .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }
        .panel-header h3 {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .info-tag-purple {
          background: rgba(139, 92, 246, 0.08);
          border: 1px solid rgba(139, 92, 246, 0.15);
          color: var(--accent-purple);
          border-radius: 12px;
          padding: 3px 10px;
          font-size: 11px;
          font-weight: 500;
        }
        
        /* Custom UI Tables */
        .table-responsive {
          overflow-x: auto;
          width: 100%;
        }
        .custom-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
        }
        .custom-table th {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-color);
        }
        .custom-table td {
          padding: 14px 16px;
          border-bottom: 1px solid var(--border-color);
          font-size: 14px;
          color: var(--text-primary);
        }
        .custom-table tr:hover td {
          background: rgba(255, 255, 255, 0.01);
        }
        .product-cell-name {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .product-cell-name strong {
          color: var(--text-primary);
          font-weight: 500;
        }
        .product-cell-name span {
          font-size: 11px;
          color: var(--text-muted);
        }
        .action-btn-reorder {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%);
          border: none;
          color: #ffffff;
          font-size: 12px;
          font-weight: 600;
          border-radius: 6px;
          padding: 6px 12px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .action-btn-reorder:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 10px rgba(139, 92, 246, 0.3);
        }
        .empty-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 15px;
          padding: 40px 0;
          color: var(--text-secondary);
        }
        .check-success {
          color: var(--accent-green);
          background: rgba(52, 211, 153, 0.08);
          border-radius: 50%;
          padding: 6px;
        }
        
        /* Forecasting Line Graph Styles */
        .product-select {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          padding: 4px 12px;
          font-size: 13px;
          color: var(--text-primary);
          outline: none;
        }
        .forecast-chart-container {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .chart-canvas-wrapper {
          position: relative;
          height: 180px;
          width: 100%;
        }
        .forecast-summary-card {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--border-color);
          border-radius: 10px;
          padding: 16px;
        }
        .summary-stat-row {
          display: flex;
          justify-content: space-around;
          margin-bottom: 12px;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--border-color);
        }
        .sub-stat {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }
        .sub-stat span {
          font-size: 11px;
          color: var(--text-secondary);
        }
        .sub-stat strong {
          font-size: 16px;
          font-weight: 700;
        }
        .forecast-explanation {
          display: flex;
          gap: 10px;
          align-items: flex-start;
          font-size: 12px;
          color: var(--text-secondary);
          line-height: 1.4;
        }
        
        /* Inventory grid */
        .inventory-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 20px;
          margin-top: 20px;
        }
        .inventory-card {
          background: var(--bg-card);
          backdrop-filter: blur(10px);
          border: 1px solid var(--border-color);
          border-radius: 14px;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          box-shadow: var(--shadow-card);
        }
        .card-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }
        .card-title-grp h3 {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .item-category {
          font-size: 11px;
          color: var(--text-muted);
        }
        .status-badge {
          font-size: 10px;
          font-weight: 700;
          padding: 3px 8px;
          border-radius: 20px;
          text-transform: uppercase;
        }
        .status-healthy { background: rgba(52, 211, 153, 0.1); color: var(--accent-green); border: 1px solid rgba(52, 211, 153, 0.2); }
        .status-critical { background: rgba(248, 113, 113, 0.1); color: var(--accent-red); border: 1px solid rgba(248, 113, 113, 0.2); }
        .status-warning { background: rgba(251, 191, 36, 0.1); color: var(--accent-amber); border: 1px solid rgba(251, 191, 36, 0.2); }
        
        .card-metrics {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          padding: 12px;
          background: rgba(255, 255, 255, 0.02);
          border-radius: 8px;
          text-align: center;
        }
        .metric {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .metric span {
          font-size: 10px;
          color: var(--text-secondary);
        }
        .metric strong {
          font-size: 15px;
          font-weight: 700;
        }
        
        .health-bar-container {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .health-bar-label {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: var(--text-secondary);
        }
        .health-bar-bg {
          height: 6px;
          background: var(--bg-tertiary);
          border-radius: 3px;
          overflow: hidden;
        }
        .health-bar-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.5s ease-out;
        }
        
        .card-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .card-action-btn {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          padding: 8px;
          color: var(--text-primary);
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.2s;
        }
        .card-action-btn:hover { background: rgba(255, 255, 255, 0.08); }
        .card-action-btn-adjust {
          background: rgba(167, 139, 250, 0.08);
          border: 1px solid rgba(167, 139, 250, 0.15);
          border-radius: 6px;
          padding: 8px;
          color: var(--accent-purple);
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }
        .card-action-btn-adjust:hover { background: rgba(167, 139, 250, 0.15); }
        
        /* Multi-Agent Chat Console */
        .chat-container {
          height: calc(100vh - 120px);
        }
        .chat-layout {
          display: grid;
          grid-template-columns: 1.6fr 1fr;
          height: 100%;
          gap: 20px;
        }
        .chat-main-panel {
          background: var(--bg-card);
          border: 1px solid var(--border-color);
          border-radius: 14px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: var(--shadow-card);
        }
        .chat-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-color);
          background: rgba(255, 255, 255, 0.01);
        }
        .chat-header h2 { font-size: 16px; font-weight: 600; }
        .chat-header p { font-size: 12px; color: var(--text-secondary); }
        .reset-session-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          background: transparent;
          border: 1px solid var(--border-color);
          border-radius: 6px;
          padding: 6px 12px;
          color: var(--text-secondary);
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .reset-session-btn:hover { background: rgba(255, 255, 255, 0.03); color: var(--text-primary); }
        
        .chat-body-messages {
          flex: 1;
          padding: 20px;
          overflow-y: auto;
        }
        .chat-welcome {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 40px 20px;
          gap: 15px;
          max-width: 500px;
          margin: 0 auto;
        }
        .chat-welcome h3 { font-size: 18px; font-weight: 600; }
        .chat-welcome p { font-size: 13px; color: var(--text-secondary); line-height: 1.5; }
        
        .quick-prompts-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          width: 100%;
          margin-top: 15px;
        }
        .quick-prompt-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 10px 14px;
          color: var(--text-secondary);
          font-size: 12px;
          text-align: left;
          cursor: pointer;
          transition: all 0.2s;
        }
        .quick-prompt-card:hover {
          background: rgba(139, 92, 246, 0.05);
          border-color: rgba(139, 92, 246, 0.2);
          color: var(--text-primary);
        }
        
        .messages-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .chat-message {
          display: flex;
          gap: 12px;
          animation: fadeIn 0.2s ease-out;
        }
        .chat-message.user {
          flex-direction: row-reverse;
        }
        .message-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .chat-message.user .message-avatar {
          background: var(--bg-tertiary);
          color: var(--text-primary);
        }
        .chat-message.agent .message-avatar {
          background: rgba(139, 92, 246, 0.1);
          border: 1px solid rgba(139, 92, 246, 0.2);
          color: var(--accent-purple);
        }
        .message-content {
          max-width: 75%;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .chat-message.user .message-content {
          align-items: flex-end;
        }
        .message-author {
          font-size: 11px;
          color: var(--text-secondary);
          font-weight: 500;
        }
        .message-text {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          padding: 12px 16px;
          font-size: 14px;
          color: var(--text-primary);
          line-height: 1.5;
          white-space: pre-wrap;
        }
        .chat-message.user .message-text {
          background: rgba(139, 92, 246, 0.08);
          border-color: rgba(139, 92, 246, 0.15);
        }
        
        .chat-footer-input {
          padding: 16px 20px;
          border-top: 1px solid var(--border-color);
          background: rgba(255, 255, 255, 0.01);
        }
        .chat-form {
          display: flex;
          gap: 10px;
        }
        .chat-form input {
          flex: 1;
          background: rgba(30, 41, 59, 0.4);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 12px 16px;
          color: #f8fafc;
          font-size: 14px;
          outline: none;
          transition: border-color 0.2s;
        }
        .chat-form input:focus { border-color: var(--accent-purple); }
        .chat-form button {
          background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%);
          border: none;
          border-radius: 8px;
          width: 45px;
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
        }
        .chat-form button:hover { transform: translateY(-1px); }
        
        /* Agent Collaboration Visualizer Right Panel */
        .chat-visualizer-panel {
          background: var(--bg-card);
          border: 1px solid var(--border-color);
          border-radius: 14px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: var(--shadow-card);
        }
        .visualizer-header {
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-color);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .visualizer-header h3 { font-size: 14px; font-weight: 600; }
        .visualizer-header span { font-size: 11px; color: var(--text-muted); text-transform: uppercase; }
        .visualizer-body {
          flex: 1;
          padding: 20px;
          overflow-y: auto;
        }
        .empty-visualizer {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          text-align: center;
          color: var(--text-secondary);
          gap: 12px;
        }
        .empty-visualizer p { font-size: 12px; max-width: 220px; }
        
        /* Visual trace timeline flowchart */
        .trace-timeline {
          display: flex;
          flex-direction: column;
          position: relative;
          padding-left: 20px;
          border-left: 1px solid rgba(255, 255, 255, 0.05);
        }
        .trace-item {
          position: relative;
          margin-bottom: 20px;
          animation: fadeIn 0.3s ease-out;
        }
        .trace-dot {
          position: absolute;
          left: -24px;
          top: 6px;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--text-muted);
        }
        .trace-transition .trace-dot {
          background: var(--accent-purple);
          box-shadow: 0 0 8px var(--accent-purple);
        }
        .trace-tool_call .trace-dot {
          background: var(--accent-blue);
          box-shadow: 0 0 8px var(--accent-blue);
        }
        .trace-tool_response .trace-dot {
          background: var(--accent-green);
        }
        .trace-content-box {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 10px 14px;
        }
        .trace-transition .trace-content-box {
          border-color: rgba(139, 92, 246, 0.15);
          background: rgba(139, 92, 246, 0.01);
        }
        .trace-meta {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          margin-bottom: 4px;
        }
        .trace-agent { font-weight: 600; color: var(--accent-purple); }
        .trace-time { color: var(--text-muted); }
        .trace-message {
          font-size: 12px;
          color: var(--text-primary);
          line-height: 1.4;
        }
        
        /* Order Approval Styles */
        .po-status-pending_approval { background: rgba(251, 191, 36, 0.1); color: var(--accent-amber); border: 1px solid rgba(251, 191, 36, 0.2); }
        .po-status-reordered { background: rgba(99, 102, 241, 0.1); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.2); }
        .po-status-approved { background: rgba(52, 211, 153, 0.1); color: var(--accent-green); border: 1px solid rgba(52, 211, 153, 0.2); }
        .po-status-rejected { background: rgba(248, 113, 113, 0.1); color: var(--accent-red); border: 1px solid rgba(248, 113, 113, 0.2); }
        
        .po-actions {
          display: flex;
          gap: 8px;
        }
        .po-approve-btn {
          background: rgba(52, 211, 153, 0.08);
          border: 1px solid rgba(52, 211, 153, 0.15);
          border-radius: 4px;
          padding: 4px 10px;
          color: var(--accent-green);
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .po-approve-btn:hover { background: rgba(52, 211, 153, 0.15); }
        .po-reject-btn {
          background: rgba(248, 113, 113, 0.08);
          border: 1px solid rgba(248, 113, 113, 0.15);
          border-radius: 4px;
          padding: 4px 10px;
          color: var(--accent-red);
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .po-reject-btn:hover { background: rgba(248, 113, 113, 0.15); }
        .po-validated-by {
          font-size: 12px;
          color: var(--text-secondary);
        }
        
        /* Audit Trail Logs */
        .logs-table td {
          font-size: 13px;
        }
        .log-time-cell {
          color: var(--text-secondary);
          white-space: nowrap;
        }
        .log-agent-name {
          color: var(--accent-purple);
        }
        .log-action {
          font-weight: 500;
        }
        .log-details-cell {
          color: var(--text-secondary);
          line-height: 1.4;
        }
        
        /* Dot animation */
        .loading-dots {
          display: inline-flex;
          gap: 4px;
          margin-top: 4px;
        }
        .loading-dots span {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent-purple);
          animation: pulse-glow 1s infinite alternate;
        }
        .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
        .loading-dots span:nth-child(3) { animation-delay: 0.4s; }

        /* Custom Modals CSS */
        .custom-modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(15, 23, 42, 0.75);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 999;
          animation: fadeIn 0.2s ease-out;
        }
        .custom-modal-card {
          width: 90%;
          max-width: 450px;
          background: rgba(30, 41, 59, 0.7);
          backdrop-filter: blur(25px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 16px;
          padding: 24px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1);
          animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .custom-modal-card.scrollable {
          max-height: 90vh;
          overflow-y: auto;
        }
        .modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          padding-bottom: 14px;
          margin-bottom: 16px;
        }
        .modal-header h3 {
          margin: 0;
          font-size: 18px;
          font-weight: 700;
          background: linear-gradient(135deg, #fff 0%, #cbd5e1 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .close-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }
        .close-btn:hover {
          color: #fff;
          background: rgba(255,255,255,0.05);
        }
        .modal-body select {
          width: 100%;
          padding: 10px;
          background: #1e293b;
          border: 1px solid var(--border-color);
          border-radius: 6px;
          color: var(--text-color);
          outline: none;
          transition: border-color 0.2s;
        }
        .modal-body select:focus {
          border-color: var(--accent-purple);
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
