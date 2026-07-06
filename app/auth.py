import os
import jwt
import datetime
from fastapi import Depends, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import firebase_admin
from firebase_admin import auth as firebase_auth, credentials

JWT_SECRET = os.getenv("JWT_SECRET", "shelfiq-enterprise-secret-key-123456")
JWT_ALGORITHM = "HS256"

# Initialize Firebase Admin SDK if service account is provided
FIREBASE_CREDENTIALS_PATH = os.getenv("FIREBASE_CREDENTIALS_PATH")
firebase_enabled = False

if FIREBASE_CREDENTIALS_PATH and os.path.exists(FIREBASE_CREDENTIALS_PATH):
    try:
        cred = credentials.Certificate(FIREBASE_CREDENTIALS_PATH)
        firebase_admin.initialize_app(cred)
        firebase_enabled = True
        print("Auth: Firebase Admin SDK initialized successfully.")
    except Exception as e:
        print(f"Auth: Failed to initialize Firebase Admin SDK: {e}")

security = HTTPBearer()

def create_access_token(uid: str, email: str, role: str, name: str, store_id: str = "ALL") -> str:
    """Create a simulated JWT for local authentication."""
    expire = datetime.datetime.utcnow() + datetime.timedelta(hours=24)
    to_encode = {
        "uid": uid,
        "email": email,
        "role": role,
        "name": name,
        "store_id": store_id,
        "exp": expire,
        "iss": "shelfiq-backend"
    }
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)

def verify_token(credentials: HTTPAuthorizationCredentials = Security(security)) -> dict:
    """Verify bearer token (local JWT or Firebase Auth)."""
    token = credentials.credentials
    
    # 1. Try decoding as local JWT first
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM], issuer="shelfiq-backend")
        return payload
    except jwt.PyJWTError:
        pass
        
    # 2. Try decoding as Firebase token if Firebase is configured
    if firebase_enabled:
        try:
            decoded_token = firebase_auth.verify_id_token(token)
            # Default to Store Manager if custom claims aren't set yet
            role = decoded_token.get("role", "Store Manager")
            return {
                "uid": decoded_token["uid"],
                "email": decoded_token.get("email", ""),
                "role": role,
                "name": decoded_token.get("name", decoded_token.get("email", "Firebase User"))
            }
        except Exception as e:
            raise HTTPException(status_code=401, detail=f"Invalid Firebase ID Token: {e}")
            
    # 3. Development Fallback: If token is a raw role name (e.g. 'Admin', 'Store Manager'),
    # allow it for rapid CLI/frontend testing when no auth headers are configured yet
    if token in ["Admin", "Store Manager", "Warehouse Manager", "Finance"]:
        return {
            "uid": f"mock-{token.lower()}",
            "email": f"{token.lower().replace(' ', '')}@shelfiq.com",
            "role": token,
            "name": f"Mock {token}"
        }
        
    raise HTTPException(status_code=401, detail="Invalid authorization token.")

class RoleChecker:
    def __init__(self, allowed_roles: list[str]):
        self.allowed_roles = allowed_roles

    def __call__(self, current_user: dict = Depends(verify_token)) -> dict:
        user_role = current_user.get("role")
        if user_role not in self.allowed_roles and current_user.get("role") != "Admin":
            raise HTTPException(
                status_code=403, 
                detail=f"Access forbidden: User role '{user_role}' is not authorized. Allowed: {self.allowed_roles}"
            )
        return current_user

# Predefined RBAC dependencies
require_admin = Depends(RoleChecker(["Admin"]))
require_store_manager = Depends(RoleChecker(["Store Manager", "Admin"]))
require_warehouse_manager = Depends(RoleChecker(["Warehouse Manager", "Store Manager", "Admin"]))
require_finance = Depends(RoleChecker(["Finance", "Admin"]))
require_any_user = Depends(verify_token)
