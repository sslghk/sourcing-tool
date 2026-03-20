from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import httpx
import redis
import json
import os
import base64
import io
from PIL import Image
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Load environment variables from project root
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', '.env'))

app = FastAPI(
    title="Taobao Service",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://sourcing-tool-three.vercel.app",
        "https://sourcing-tool-45q9jjdtq-andrew-huens-projects.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Make Redis optional
try:
    redis_client = redis.Redis(
        host=os.getenv("REDIS_HOST", "localhost"),
        port=int(os.getenv("REDIS_PORT", "6379")),
        decode_responses=True
    )
    # Test connection
    redis_client.ping()
    print("Redis connected successfully")
    REDIS_AVAILABLE = True
except Exception as e:
    print(f"Redis not available, caching disabled: {e}")
    redis_client = None
    REDIS_AVAILABLE = False

ONEBOUND_API_KEY = os.getenv("ONEBOUND_API_KEY", "")
ONEBOUND_API_SECRET = os.getenv("ONEBOUND_API_SECRET", "")
ONEBOUND_BASE_URL = "https://api-gw.onebound.cn/taobao"

# Require OneBound API - no fallback
USE_ONEBOUND = bool(ONEBOUND_API_KEY and ONEBOUND_API_SECRET)
if not USE_ONEBOUND:
    raise RuntimeError("OneBound API keys not configured. Please set ONEBOUND_API_KEY and ONEBOUND_API_SECRET in your .env file.")

print(f"OneBound API configured: {USE_ONEBOUND}")
print(f"OneBound API Key: {ONEBOUND_API_KEY[:10]}...")
print(f"OneBound API Secret: {'*' * len(ONEBOUND_API_SECRET)}")

class SearchRequest(BaseModel):
    query: str
    page: int = 1
    limit: int = 20
    price_min: Optional[float] = None
    price_max: Optional[float] = None
    category: Optional[str] = None

class ImageSearchRequest(BaseModel):
    image_url: str
    page: int = 1
    limit: int = 20

class ProductDTO(BaseModel):
    id: str
    source: str
    source_id: str
    title: str
    description_short: Optional[str] = None
    price: dict
    image_urls: List[str]
    url: str
    seller: dict
    attributes: dict
    fetched_at: str

class SearchResponse(BaseModel):
    products: List[ProductDTO]
    total: int
    page: int
    limit: int

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "taobao-service"}

@app.get("/product/{product_id}")
async def get_product_details(product_id: str):
    """Get detailed product information from OneBound API"""
    if not USE_ONEBOUND:
        raise HTTPException(status_code=503, detail="OneBound API not configured")
    
    cache_key = f"product_detail:{product_id}"
    
    # Try to get from cache first
    try:
        cached = redis_client.get(cache_key)
        if cached:
            print(f"Cache hit for product {product_id}")
            return json.loads(cached)
    except Exception as e:
        print(f"Cache error: {e}")
    
    try:
        async with httpx.AsyncClient() as client:
            # Use OneBound item_get_pro API for detailed product info
            params = {
                "key": ONEBOUND_API_KEY,
                "secret": ONEBOUND_API_SECRET,
                "num_iid": product_id,
                "lang": "en",
            }
            
            print(f"Fetching product details for {product_id}")
            
            response = await client.get(
                f"{ONEBOUND_BASE_URL}/item_get_pro",
                params=params,
                timeout=30.0
            )
            
            print(f"OneBound detail response status: {response.status_code}")
            
            response.raise_for_status()
            data = response.json()
            
            # Check for API errors
            if data.get("error"):
                print(f"OneBound API error: {data.get('error')}")
                raise HTTPException(status_code=503, detail=f"OneBound API error: {data.get('error')}")
            
            # Extract item data
            item = data.get("item", {})
            
            if not item:
                raise HTTPException(status_code=404, detail="Product not found")
            
            # Debug: Log all available fields to understand the API response structure
            print(f"\n=== OneBound API Response for {product_id} ===")
            print(f"Available fields: {list(item.keys())}")
            print(f"favcount: {item.get('favcount')}")
            print(f"fanscount: {item.get('fanscount')}")
            print(f"created_time: {item.get('created_time')}")
            print(f"rate_grade: {item.get('rate_grade')}")
            print(f"volume: {item.get('volume')}")
            print(f"sellCount: {item.get('sellCount')}")
            print(f"sales: {item.get('sales')}")
            
            # Check for alternative field names
            print(f"collect_count: {item.get('collect_count')}")
            print(f"favs: {item.get('favs')}")
            print(f"favorites: {item.get('favorites')}")
            print(f"fans: {item.get('fans')}")
            print(f"shop_fans: {item.get('shop_fans')}")
            print(f"seller_info: {item.get('seller_info')}")
            print("=" * 50)
            
            # Build detailed response with requested fields
            details = {
                "title": item.get("title"),
                "desc_short": item.get("desc_short"),
                "brand": item.get("brand"),
                "pic_url": item.get("pic_url"),
                "item_imgs": item.get("item_imgs", []),
                "prop_imgs": item.get("prop_imgs", {}),
                "props": item.get("props", []),
                "moq": item.get("min_num") or item.get("moq") or item.get("start_amount") or 1,
                "category_id": item.get("cid"),
                "fav_count": item.get("favcount"),
                "fans_count": item.get("fanscount"),
                "created_time": item.get("created_time"),
                "rating_grade": item.get("rate_grade"),
                # Keep legacy fields for backward compatibility
                "seller": {
                    "name": item.get("nick") or item.get("shop_name", "Unknown"),
                    "location": item.get("location") or item.get("city") or item.get("provcity", "N/A"),
                    "rating": item.get("seller_credit_score"),
                },
                "sales_volume": item.get("volume") or item.get("sellCount") or item.get("sales"),
                "description": item.get("desc") or item.get("subtitle"),
            }
            
            # Cache the result for 1 hour
            try:
                redis_client.setex(cache_key, 3600, json.dumps(details))
            except Exception as e:
                print(f"Cache set error: {e}")
            
            return details
            
    except httpx.HTTPStatusError as e:
        print(f"HTTP error fetching product details: {e}")
        raise HTTPException(status_code=e.response.status_code, detail="Failed to fetch product details")
    except Exception as e:
        print(f"Error fetching product details: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/search", response_model=SearchResponse)
async def search(request: SearchRequest):
    cache_key = f"taobao:search:{request.query}:{request.page}"
    
    # Try to get from cache if Redis is available
    if REDIS_AVAILABLE and redis_client:
        try:
            cached = redis_client.get(cache_key)
            if cached:
                return SearchResponse(**json.loads(cached))
        except Exception as e:
            print(f"Cache error: {e}")
    
    try:
        async with httpx.AsyncClient() as client:
            # Use OneBound API (required)
            print(f"Using OneBound API for query: {request.query}")
            params = {
                "key": ONEBOUND_API_KEY,
                "secret": ONEBOUND_API_SECRET,
                "q": request.query,
                "page": request.page,
                "pageSize": request.limit,
                "lang": "en",
            }
            
            if request.price_min:
                params["start_price"] = request.price_min
            if request.price_max:
                params["end_price"] = request.price_max
            
            print(f"OneBound request params (secret hidden): {dict(params, secret='***')}")
            
            response = await client.get(
                f"{ONEBOUND_BASE_URL}/item_search",
                params=params,
                timeout=30.0
            )
            
            print(f"OneBound response status: {response.status_code}")
            
            # Handle specific error codes
            if response.status_code == 403:
                error_detail = response.text[:200]
                print(f"OneBound 403 Forbidden: {error_detail}")
                print("Possible causes: Invalid API key, quota exceeded, or IP blocked")
                raise HTTPException(status_code=403, detail=f"OneBound API authentication failed: {error_detail}")
            
            print(f"OneBound response preview: {response.text[:500]}")
            
            response.raise_for_status()
            data = response.json()
            
            # OneBound API response structure
            if data.get("error"):
                print(f"OneBound API error: {data.get('error')}")
                raise HTTPException(status_code=503, detail=f"OneBound API error: {data.get('error')}")
            
            # OneBound nests items under items.item
            items_data = data.get("items", {})
            items = items_data.get("item", []) if isinstance(items_data, dict) else []
            
            print(f"OneBound response: {len(items)} items found")
            
            if items:
                print(f"Sample item keys: {list(items[0].keys()) if items else 'No items'}")
                print(f"Sample item data: {items[0] if items else 'No items'}")
            
            products = [normalize_onebound_product(item) for item in items]
            print(f"Successfully normalized {len(products)} products")
            
            # If no products found, return mock data for testing
            if len(products) == 0:
                print("No products found, returning mock data for testing")
                products = [
                    ProductDTO(
                        id="taobao_mock_1",
                        source="taobao",
                        source_id="mock_1",
                        title=f"Sample Product for '{request.query}'",
                        description_short="This is a sample product while we debug the scraping",
                        price={"current": 99.99, "currency": "CNY"},
                        image_urls=["https://via.placeholder.com/200"],
                        url="https://www.taobao.com",
                        seller={"name": "Sample Seller", "location": "China"},
                        attributes={"sales": "1000"},
                        sales_volume=1000,
                        fetched_at=datetime.utcnow().isoformat()
                    )
                ]
            
            result = SearchResponse(
                products=products,
                total=len(products),
                page=request.page,
                limit=request.limit
            )
            
            # Cache result if Redis is available
            if REDIS_AVAILABLE and redis_client:
                try:
                    redis_client.setex(
                        cache_key,
                        3600,
                        result.json()
                    )
                except Exception as e:
                    print(f"Cache set error: {e}")
            
            return result
            
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail=f"External API error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")

@app.get("/detail/{product_id}", response_model=ProductDTO)
async def get_detail(product_id: str):
    cache_key = f"taobao:product:{product_id}"
    
    # Try to get from cache if Redis is available
    if REDIS_AVAILABLE and redis_client:
        try:
            cached = redis_client.get(cache_key)
            if cached:
                return ProductDTO(**json.loads(cached))
        except Exception as e:
            print(f"Cache error: {e}")
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{ONEBOUND_BASE_URL}/item_get",
                params={
                    "key": ONEBOUND_API_KEY,
                    "num_iid": product_id,
                },
                timeout=10.0
            )
            response.raise_for_status()
            data = response.json()
            
            item = data.get("item", {})
            product = normalize_product(item)
            
            # Cache result if Redis is available
            if REDIS_AVAILABLE and redis_client:
                try:
                    redis_client.setex(
                        cache_key,
                        21600,
                        product.json()
                    )
                except Exception as e:
                    print(f"Cache set error: {e}")
            
            return product
            
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail=f"External API error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")


def normalize_onebound_product(raw: dict) -> ProductDTO:
    """Normalize OneBound API response to ProductDTO"""
    # OneBound API field mapping
    num_iid = raw.get('num_iid') or raw.get('itemId') or raw.get('id', '')
    title = raw.get('title') or raw.get('item_title', '')
    price = float(raw.get('price') or raw.get('priceWap') or raw.get('reservePrice', 0))
    pic_url = raw.get('pic_url') or raw.get('picUrl') or raw.get('mainPic', '')
    detail_url = raw.get('detail_url') or raw.get('itemUrl') or raw.get('url', '')
    nick = raw.get('nick') or raw.get('shopName') or raw.get('sellerNick', 'Unknown')
    location = raw.get('location') or raw.get('city') or raw.get('provcity', '')
    volume = raw.get('volume') or raw.get('sellCount') or raw.get('sales', 0)
    
    # Extract MOQ (Minimum Order Quantity) - check various possible fields
    moq = raw.get('moq') or raw.get('min_order_quantity') or raw.get('minimum_order') or raw.get('start_amount', 1)
    
    # Build image URLs list
    image_urls = []
    if pic_url:
        image_urls.append(pic_url)
    
    # Add additional images if available
    item_imgs = raw.get('item_imgs') or raw.get('images') or []
    if isinstance(item_imgs, list):
        image_urls.extend([img.get('url', '') if isinstance(img, dict) else str(img) for img in item_imgs])
    
    return ProductDTO(
        id=f"taobao_{num_iid}",
        source="taobao",
        source_id=str(num_iid),
        title=title,
        description_short=raw.get('desc') or raw.get('subtitle', ''),
        price={
            "current": price,
            "currency": "CNY",
            "original": float(raw.get('original_price') or raw.get('originalPrice', price))
        },
        image_urls=[url for url in image_urls if url],
        url=detail_url,
        moq=int(moq) if moq else None,
        seller={
            "name": nick,
            "id": raw.get('seller_id') or raw.get('sellerId'),
            "rating": raw.get('seller_credit_score') or raw.get('creditLevel'),
            "location": location
        },
        attributes={
            "sales": str(volume),
            "shopType": raw.get('shopType', ''),
        },
        sales_volume=int(volume) if volume else 0,
        fetched_at=datetime.utcnow().isoformat()
    )

def normalize_product(raw: dict) -> ProductDTO:
    return ProductDTO(
        id=f"taobao_{raw.get('num_iid', '')}",
        source="taobao",
        source_id=str(raw.get('num_iid', '')),
        title=raw.get('title', ''),
        description_short=raw.get('desc', ''),
        price={
            "current": float(raw.get('price', 0)),
            "currency": "CNY",
            "original": float(raw.get('original_price', raw.get('price', 0)))
        },
        image_urls=[raw.get('pic_url', '')] + raw.get('item_imgs', []),
        url=raw.get('detail_url', ''),
        seller={
            "name": raw.get('nick', 'Unknown'),
            "id": raw.get('seller_id'),
            "rating": raw.get('seller_credit_score')
        },
        attributes={
            "sales": str(raw.get('volume', 0)),
            "location": raw.get('location', ''),
        },
        fetched_at=datetime.utcnow().isoformat()
    )

@app.post("/search-image", response_model=SearchResponse)
async def search_by_image(image: UploadFile = File(...)):
    """
    Search for products using an uploaded image.
    Uses OneBound's item_search_img API.
    """
    if not USE_ONEBOUND:
        raise HTTPException(status_code=503, detail="OneBound API not configured")
    
    try:
        # Read image file
        image_bytes = await image.read()
        
        # Create cache key from image hash
        import hashlib
        image_hash = hashlib.md5(image_bytes).hexdigest()
        cache_key = f"taobao:image_search:{image_hash}"
        
        # Check cache
        try:
            cached = redis_client.get(cache_key)
            if cached:
                print(f"Returning cached results for image hash: {image_hash}")
                return SearchResponse(**json.loads(cached))
        except Exception as e:
            print(f"Cache error: {e}")
        
        async with httpx.AsyncClient() as client:
            print(f"Using OneBound image search for: {image.filename}")
            
            # Step 1: Upload to ImgBB to get a public URL
            print("Step 1: Uploading to ImgBB...")
            imgbb_api_key = os.getenv("IMGBB_API_KEY")
            if not imgbb_api_key:
                raise HTTPException(status_code=503, detail="ImgBB API key not configured")
            
            image_base64 = base64.b64encode(image_bytes).decode('utf-8')
            
            imgbb_response = await client.post(
                "https://api.imgbb.com/1/upload",
                data={"key": imgbb_api_key, "image": image_base64},
                timeout=30.0
            )
            
            imgbb_response.raise_for_status()
            imgbb_data = imgbb_response.json()
            
            if not imgbb_data.get("success"):
                raise HTTPException(status_code=503, detail="ImgBB upload failed")
            
            image_url = imgbb_data["data"]["url"]
            print(f"Image uploaded to ImgBB: {image_url}")
            
            # Step 2: Upload image URL to OneBound to get image_id
            print("Step 2: Uploading to OneBound...")
            upload_params = {
                "key": ONEBOUND_API_KEY,
                "secret": ONEBOUND_API_SECRET,
                "imgcode": image_url,
                "img_type": "1"
            }
            
            print(f"OneBound upload_img URL: {ONEBOUND_BASE_URL}/upload_img")
            print(f"Upload params (secret hidden): {dict(upload_params, secret='***')}")
            
            upload_response = await client.get(
                f"{ONEBOUND_BASE_URL}/upload_img",
                params=upload_params,
                timeout=30.0
            )
            
            print(f"OneBound upload response status: {upload_response.status_code}")
            print(f"OneBound upload response body: {upload_response.text[:500]}")
            
            upload_response.raise_for_status()
            upload_data = upload_response.json()
            
            print(f"OneBound upload_data: {upload_data}")
            
            if upload_data.get("error"):
                error_detail = upload_data.get('error')
                print(f"OneBound upload error: {error_detail}")
                raise HTTPException(status_code=503, detail=f"OneBound upload error: {error_detail}")
            
            # Get image_id from response - try multiple possible paths
            image_id = None
            if "items" in upload_data:
                items = upload_data.get("items", {})
                if isinstance(items, dict):
                    item = items.get("item", {})
                    if isinstance(item, dict):
                        image_id = item.get("image_id")
            
            # Try alternative response structure
            if not image_id and "item" in upload_data:
                image_id = upload_data.get("item", {}).get("image_id")
            
            # Try direct image_id field
            if not image_id:
                image_id = upload_data.get("image_id")
            
            print(f"Extracted image_id: {image_id}")
            
            if not image_id:
                print(f"Full upload_data structure: {upload_data}")
                raise HTTPException(status_code=500, detail=f"No image_id in OneBound response. Response: {upload_data}")
            
            print(f"Got image_id: {image_id}")
            
            # Step 3: Search with image_id
            print("Step 3: Searching with image_id...")
            search_params = {
                "key": ONEBOUND_API_KEY,
                "secret": ONEBOUND_API_SECRET,
                "imgid": image_id,
                "lang": "en"
            }
            
            response = await client.get(
                f"{ONEBOUND_BASE_URL}/item_search_img",
                params=search_params,
                timeout=30.0
            )
            
            print(f"OneBound image search response status: {response.status_code}")
            response.raise_for_status()
            data = response.json()
            
            # Check for API errors
            if data.get("error"):
                error_msg = data.get('error')
                print(f"OneBound API error: {error_msg}")
                
                # Provide more helpful error messages
                if error_msg == "data error":
                    raise HTTPException(
                        status_code=400, 
                        detail="No similar products found for this image. Try a different image with clearer product details."
                    )
                else:
                    raise HTTPException(status_code=503, detail=f"OneBound API error: {error_msg}")
            
            # Parse results
            items = data.get("items", {}).get("item", [])
            if not isinstance(items, list):
                items = [items] if items else []
            
            # Handle empty results
            if not items:
                print("No items found in OneBound image search response")
                return SearchResponse(products=[], total=0, page=1, limit=0)
            
            products = [normalize_onebound_product(item) for item in items]
            
            result = SearchResponse(
                products=products,
                total=len(products),
                page=1,
                limit=len(products)
            )
            
            # Cache for 1 hour
            try:
                redis_client.setex(cache_key, 3600, json.dumps(result.dict()))
            except Exception as e:
                print(f"Cache set error: {e}")
            
            return result
            
    except HTTPException:
        # Re-raise HTTPException without modification
        raise
    except httpx.HTTPStatusError as e:
        print(f"HTTP error during image search: {e}")
        raise HTTPException(status_code=e.response.status_code, detail="Failed to search by image")
    except Exception as e:
        print(f"Error during image search: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
