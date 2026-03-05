from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import httpx
import redis
import json
import os
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
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

redis_client = redis.Redis(
    host=os.getenv("REDIS_HOST", "localhost"),
    port=int(os.getenv("REDIS_PORT", "6379")),
    decode_responses=True
)

SCRAPINGBEE_API_KEY = os.getenv("SCRAPINGBEE_API_KEY", "")
SCRAPINGBEE_BASE_URL = "https://app.scrapingbee.com/api/v1/"
ONEBOUND_API_KEY = os.getenv("ONEBOUND_API_KEY", "")
ONEBOUND_API_SECRET = os.getenv("ONEBOUND_API_SECRET", "")
ONEBOUND_BASE_URL = "https://api-gw.onebound.cn/taobao"

# Use OneBound if available, otherwise try ScrapingBee
USE_ONEBOUND = bool(ONEBOUND_API_KEY and ONEBOUND_API_SECRET)

print(f"OneBound API configured: {USE_ONEBOUND}")
if USE_ONEBOUND:
    print(f"OneBound API Key: {ONEBOUND_API_KEY[:10]}...")
    print(f"OneBound API Secret: {'*' * len(ONEBOUND_API_SECRET)}")

class SearchRequest(BaseModel):
    query: str
    page: int = 1
    limit: int = 20
    price_min: Optional[float] = None
    price_max: Optional[float] = None
    category: Optional[str] = None

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
            
            # Debug: Log the fields we're looking for
            print(f"OneBound API Response - favcount: {item.get('favcount')}")
            print(f"OneBound API Response - fanscount: {item.get('fanscount')}")
            print(f"OneBound API Response - created_time: {item.get('created_time')}")
            print(f"OneBound API Response - rate_grade: {item.get('rate_grade')}")
            
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
    
    try:
        cached = redis_client.get(cache_key)
        if cached:
            return SearchResponse(**json.loads(cached))
    except Exception as e:
        print(f"Cache error: {e}")
    
    try:
        async with httpx.AsyncClient() as client:
            if USE_ONEBOUND:
                # Use OneBound API (designed for Taobao)
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
                
            else:
                # Fall back to ScrapingBee (Taobao blocks this)
                print(f"Using ScrapingBee for query: {request.query}")
                taobao_url = f"https://s.taobao.com/search?q={request.query}&s={(request.page - 1) * request.limit}"
                
                params = {
                    "api_key": SCRAPINGBEE_API_KEY,
                    "url": taobao_url,
                    "render_js": "true",
                    "premium_proxy": "true",
                    "country_code": "cn",
                    "wait": "5000",
                    "wait_for": "div",
                }
                
                response = await client.get(
                    SCRAPINGBEE_BASE_URL,
                    params=params,
                    timeout=30.0
                )
                response.raise_for_status()
                
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(response.text, 'html.parser')
                
                print(f"Received HTML length: {len(response.text)} characters")
                print(f"HTML preview: {response.text[:500]}")
                
                products = parse_taobao_html(soup, request.limit)
                print(f"Parsed {len(products)} products")
            
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

def parse_taobao_html(soup, limit: int) -> List[ProductDTO]:
    """Parse Taobao search results HTML and extract product information"""
    products = []
    
    # Try multiple selector patterns for Taobao's dynamic structure
    # Look for product cards - Taobao uses various class names
    selectors = [
        '.item',
        '[class*="Card"]',
        '[class*="item"]',
        '[class*="product"]',
        'div[data-category="auctions"]',
    ]
    
    items = []
    for selector in selectors:
        items = soup.select(selector)
        if items:
            print(f"Found {len(items)} items with selector: {selector}")
            break
    
    if not items:
        print("No items found with any selector. Trying to find all divs with links...")
        # Fallback: find divs containing Taobao item links
        items = soup.find_all('div', recursive=True)
        items = [item for item in items if item.find('a', href=lambda x: x and ('item.taobao.com' in x or 'detail.tmall.com' in x))][:limit * 3]
    
    items = items[:limit * 2]  # Get more than needed to filter
    
    for idx, item in enumerate(items):
        try:
            # Extract title - try multiple patterns
            title_elem = (item.select_one('.title') or 
                         item.select_one('[class*="title"]') or
                         item.select_one('a[href*="item.taobao.com"]') or
                         item.find('a', href=lambda x: x and 'item.taobao.com' in x))
            
            if not title_elem:
                continue
                
            title = title_elem.get_text(strip=True) if hasattr(title_elem, 'get_text') else str(title_elem)
            if not title or len(title) < 3:
                continue
            
            # Extract price - try multiple patterns
            price_elem = (item.select_one('.price') or 
                         item.select_one('[class*="price"]') or
                         item.select_one('[class*="Price"]'))
            price_text = price_elem.get_text(strip=True) if price_elem else "0"
            
            # Clean price text and convert
            import re
            price_match = re.search(r'[\d.]+', price_text)
            price = float(price_match.group()) if price_match else 0.0
            
            # Extract image
            img_elem = item.select_one('img')
            image_url = img_elem.get('src', '') or img_elem.get('data-src', '') if img_elem else ''
            if image_url and not image_url.startswith('http'):
                image_url = 'https:' + image_url
            
            # Extract product URL
            link_elem = item.select_one('a[href*="item.taobao.com"], a[href*="detail.tmall.com"]')
            product_url = link_elem.get('href', '') if link_elem else ''
            if product_url and not product_url.startswith('http'):
                product_url = 'https:' + product_url
            
            # Extract product ID from URL
            import re
            product_id = ''
            if product_url:
                id_match = re.search(r'id=(\d+)', product_url)
                product_id = id_match.group(1) if id_match else str(idx)
            else:
                product_id = str(idx)
            
            # Extract sales volume
            sales_elem = item.select_one('[class*="sale"], [class*="sold"]')
            sales_text = sales_elem.get_text(strip=True) if sales_elem else '0'
            sales = int(''.join(filter(str.isdigit, sales_text))) if sales_text else 0
            
            # Extract location
            location_elem = item.select_one('[class*="location"], [class*="shop"]')
            location = location_elem.get_text(strip=True) if location_elem else 'China'
            
            product = ProductDTO(
                id=f"taobao_{product_id}",
                source="taobao",
                source_id=product_id,
                title=title,
                description_short=None,
                price={
                    "current": price,
                    "currency": "CNY",
                },
                image_urls=[image_url] if image_url else [],
                url=product_url,
                seller={
                    "name": "Taobao Seller",
                    "location": location
                },
                attributes={
                    "sales": str(sales),
                },
                sales_volume=sales,
                fetched_at=datetime.utcnow().isoformat()
            )
            products.append(product)
            
        except Exception as e:
            print(f"Error parsing product {idx}: {e}")
            continue
    
    return products

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

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
