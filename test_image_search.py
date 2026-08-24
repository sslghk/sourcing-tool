import urllib.request
import json

# Test the /search-image endpoint with the ghost wicker image
img_path = r"c:\users\jacktong.SSLG\Downloads\4BABFFAC0E780AAE6AFA4566A3A472B4.jpg"

# Read image file
with open(img_path, "rb") as f:
    image_data = f.read()

# Build multipart form data
boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
body = (
    f"------WebKitFormBoundary7MA4YWxkTrZu0gW\r\n"
    f'Content-Disposition: form-data; name="image"; filename="ghost.jpg"\r\n'
    f"Content-Type: image/jpeg\r\n\r\n"
).encode() + image_data + b"\r\n------WebKitFormBoundary7MA4YWxkTrZu0gW--\r\n"

req = urllib.request.Request(
    "http://localhost:8001/search-image",
    data=body,
    method="POST"
)
req.add_header("Content-Type", f"multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxkTrZu0gW")

try:
    resp = urllib.request.urlopen(req, timeout=60)
    result = json.loads(resp.read().decode())
    print(f"Success! Found {len(result.get('products', []))} products")
    if result.get("products"):
        for p in result["products"][:3]:
            print(f"  - {p.get('title', 'N/A')[:50]} | Price: {p.get('price', 'N/A')}")
except urllib.error.HTTPError as e:
    error_body = e.read().decode()
    print(f"HTTP Error {e.code}: {error_body}")
except Exception as e:
    print(f"Error: {e}")
