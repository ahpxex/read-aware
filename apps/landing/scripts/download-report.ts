const days = Number(process.argv[2] ?? 30);
if (!Number.isInteger(days) || days < 1 || days > 90)
  throw new Error("Days must be an integer from 1 to 90");
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_ANALYTICS_TOKEN;
if (!account || !/^[a-f0-9]{32}$/.test(account) || !token) {
  throw new Error(
    "Set CLOUDFLARE_ACCOUNT_ID and a CLOUDFLARE_ANALYTICS_TOKEN with Account Analytics Read permission",
  );
}
const sql = `SELECT blob2 AS event, blob3 AS source, blob4 AS landing_page,
  blob5 AS click_page, blob6 AS platform, blob7 AS asset, blob8 AS advertised_release,
  SUM(_sample_interval * double1) AS estimated_events
FROM readaware_site_events
WHERE blob1 = 'v1' AND timestamp >= NOW() - INTERVAL '${days}' DAY
GROUP BY blob2, blob3, blob4, blob5, blob6, blob7, blob8
ORDER BY estimated_events DESC
FORMAT JSON`;
const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`,
  {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: sql,
    signal: AbortSignal.timeout(30_000),
  },
);
if (!response.ok)
  throw new Error(
    `Analytics query returned HTTP ${response.status}; check permissions and whether the first production event has created the dataset`,
  );
console.log(JSON.stringify(await response.json(), null, 2));
export {};
