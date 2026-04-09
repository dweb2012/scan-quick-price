

## Problem

The "Failed to fetch" error when modifying stock happens because the browser makes a direct API call to your Dolibarr server. In the **Lovable Preview environment**, the fetch proxy can intercept and break these POST/PUT requests. This is a known limitation of the preview — it does **not** affect the published site.

## Solution

**Test on your published URL** (`scan-quick-price.lovable.app` or `scan.chrelite.fr`) — the stock modification should work correctly there.

If the issue also occurs on the published URL, then it's a CORS problem on the Dolibarr side. In that case, the fix would be:

1. **Create a backend proxy function** that forwards stock/extrafield update requests to Dolibarr server-side, bypassing browser CORS restrictions
2. **Update `dolibarr.ts`** to route POST/PUT calls through this proxy instead of calling Dolibarr directly from the browser

### Technical details

- Create an edge function `dolibarr-proxy` that accepts the endpoint + method + body, reads Dolibarr credentials from the database, and forwards the request server-side
- Update `updateProductStock()` and `updateProductExtrafields()` in `dolibarr.ts` to call this proxy
- This also improves security by keeping the Dolibarr API key server-side

## Recommendation

**First step**: Publish and test on your published URL. If it works there, no code change is needed — it's just a preview limitation. If it fails there too, I'll implement the proxy approach.

