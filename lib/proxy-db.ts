type ProxySqlResponse = {
  rows?: Record<string, unknown>[];
  error?: string;
  command?: string;
  rowCount?: number;
  db_name?: string;
  access?: string;
};

function getProxyConfig() {
  const proxyUrl = process.env.PG_PROXY_URL;
  const database = process.env.PG_PROXY_DATABASE;
  const token = process.env.PG_PROXY_TOKEN;

  if (!proxyUrl || !database || !token) {
    throw new Error('PG_PROXY_URL, PG_PROXY_DATABASE, and PG_PROXY_TOKEN must be set.');
  }

  return { proxyUrl, database, token };
}

export async function queryProxy<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const { proxyUrl, database, token } = getProxyConfig();
  const response = await fetch(proxyUrl, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      db_name: database,
      sql,
      params,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });

  const payload = (await response.json()) as ProxySqlResponse;
  if (!response.ok || payload.error) {
    throw new Error(
      payload.error || 'Proxy query failed with status ' + response.status + '.',
    );
  }

  return (payload.rows ?? []) as T[];
}
