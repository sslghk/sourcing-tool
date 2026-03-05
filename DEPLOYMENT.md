# Deployment Guide

This guide covers deploying the Sourcing Assistant application with separate frontend and backend services.

## Architecture

- **Frontend (Next.js)**: Deployed on Vercel
- **Backend (Python FastAPI)**: Deployed on Railway/Render
- **Database**: PostgreSQL (Vercel Postgres or external)
- **Cache**: Redis (Railway/Render built-in)

---

## Backend Deployment (Taobao Service)

### Option 1: Railway (Recommended)

1. **Create Railway Account**
   - Go to https://railway.app
   - Sign up with GitHub

2. **Deploy Taobao Service**
   ```bash
   # Install Railway CLI
   npm install -g @railway/cli
   
   # Login
   railway login
   
   # Navigate to service directory
   cd services/taobao
   
   # Initialize and deploy
   railway init
   railway up
   ```

3. **Add Redis**
   - In Railway dashboard, click "New" → "Database" → "Redis"
   - Railway will automatically set `REDIS_HOST` and `REDIS_PORT` environment variables

4. **Set Environment Variables**
   In Railway dashboard, add:
   - `ONEBOUND_API_KEY`: Your OneBound API key
   - `ONEBOUND_API_SECRET`: Your OneBound API secret
   - `SCRAPINGBEE_API_KEY`: (Optional) Your ScrapingBee key

5. **Get Service URL**
   - Railway will provide a public URL like: `https://taobao-service-production.up.railway.app`
   - Copy this URL

### Option 2: Render

1. **Create Render Account**
   - Go to https://render.com
   - Sign up with GitHub

2. **Deploy Using Blueprint**
   ```bash
   # Push the render.yaml to your repo
   git add services/taobao/render.yaml
   git commit -m "Add Render deployment config"
   git push
   ```

3. **Create New Blueprint**
   - In Render dashboard, click "New" → "Blueprint"
   - Connect your GitHub repository
   - Select the `services/taobao/render.yaml` file
   - Render will create both the web service and Redis instance

4. **Set Environment Variables**
   - `ONEBOUND_API_KEY`: Your OneBound API key
   - `ONEBOUND_API_SECRET`: Your OneBound API secret
   - `SCRAPINGBEE_API_KEY`: (Optional) Your ScrapingBee key

5. **Get Service URL**
   - Render will provide a URL like: `https://taobao-service.onrender.com`

---

## Frontend Deployment (Vercel)

### Update Environment Variables

1. **In Vercel Dashboard**
   - Go to your project settings
   - Navigate to "Environment Variables"
   - Add/Update:
     ```
     TAOBAO_SERVICE_URL=https://your-taobao-service.railway.app
     ONEBOUND_API_KEY=your_key_here
     GEMINI_API_KEY=your_gemini_key_here
     ```

2. **Redeploy**
   - Vercel will automatically redeploy when you push to GitHub
   - Or manually trigger: `vercel --prod`

---

## Local Development

For local development, keep using localhost:

```env
# .env.local
TAOBAO_SERVICE_URL=http://localhost:8001
```

Start the service locally:
```bash
cd services/taobao
python main.py
```

---

## Testing the Deployment

1. **Test Backend Health**
   ```bash
   curl https://your-service-url.railway.app/health
   ```
   
   Expected response:
   ```json
   {"status": "healthy", "service": "taobao-service"}
   ```

2. **Test Search Endpoint**
   ```bash
   curl -X POST https://your-service-url.railway.app/search \
     -H "Content-Type: application/json" \
     -d '{"query": "laptop", "page": 1, "limit": 10}'
   ```

3. **Test Frontend**
   - Visit your Vercel URL
   - Try searching for products
   - Check browser console for errors

---

## Monitoring

### Railway
- View logs in Railway dashboard
- Monitor resource usage
- Set up alerts

### Render
- View logs in Render dashboard
- Monitor metrics
- Configure health checks

---

## Cost Estimates

### Free Tier Limits

**Railway:**
- $5 free credit per month
- ~500 hours of runtime
- 512MB RAM per service
- 1GB Redis

**Render:**
- Free web services (with limitations)
- 750 hours/month
- 512MB RAM
- Free Redis (25MB)

**Vercel:**
- 100GB bandwidth
- Unlimited deployments
- Serverless function execution

### Paid Plans (if needed)

**Railway:** $5/month per service (pay-as-you-go)
**Render:** $7/month per service
**Vercel:** $20/month Pro plan

---

## Troubleshooting

### Backend Service Won't Start
- Check logs in Railway/Render dashboard
- Verify all environment variables are set
- Ensure `requirements.txt` is up to date

### Frontend Can't Connect to Backend
- Verify `TAOBAO_SERVICE_URL` in Vercel environment variables
- Check CORS settings in `main.py`
- Ensure backend service is running

### Redis Connection Issues
- Verify Redis is provisioned
- Check `REDIS_HOST` and `REDIS_PORT` environment variables
- Test Redis connection in backend logs

---

## Security Checklist

- [ ] All API keys stored as environment variables
- [ ] CORS configured to allow only your frontend domain
- [ ] Redis password set (if using external Redis)
- [ ] HTTPS enabled on all services
- [ ] Rate limiting configured
- [ ] Secrets not committed to Git

---

## Next Steps

1. Deploy Taobao service to Railway/Render
2. Update Vercel environment variables
3. Test the full flow
4. Monitor logs and performance
5. Consider adding other platform services (1688, Temu, Amazon) similarly
