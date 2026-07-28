const fs = require('node:fs');
const path = require('node:path');

const projectRef = 'jhllbqzdapjeuuuuzcxh';
const revisionId = '8e59f0ee-0ef9-4259-a262-bba10d298808';
const outputPath = path.resolve(
  __dirname,
  '../src/services/legacy/feenstraMay2026Pricing.generated.json'
);

async function main() {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('SUPABASE_ACCESS_TOKEN is required to snapshot the pinned May pricing revision.');
  }

  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `
          select id, revision_number, pricing_json
          from public.franchise_pricing_model_revisions
          where id = '${revisionId}';
        `,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Unable to load the May pricing revision (${response.status}).`);
  }

  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.id !== revisionId) {
    throw new Error('The pinned May pricing revision was not returned exactly once.');
  }
  if (Number(rows[0].revision_number) !== 1 || !rows[0].pricing_json) {
    throw new Error('The pinned May pricing revision metadata did not match the expected snapshot.');
  }

  fs.writeFileSync(outputPath, `${JSON.stringify(rows[0].pricing_json, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${path.relative(process.cwd(), outputPath)}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
