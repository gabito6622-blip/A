// Genera postman_collection.json desde openapi.yaml.
// Uso: node scripts/gen-postman.mjs
import fs from "node:fs";
import converter from "openapi-to-postmanv2";

const spec = fs.readFileSync(new URL("../openapi.yaml", import.meta.url), "utf8");

converter.convert({ type: "string", data: spec }, { folderStrategy: "Tags" }, (err, result) => {
  if (err) { console.error("Error:", err); process.exit(1); }
  if (!result.result) { console.error("Conversión falló:", result.reason); process.exit(1); }
  const collection = result.output[0].data;
  const out = new URL("../postman_collection.json", import.meta.url);
  fs.writeFileSync(out, JSON.stringify(collection, null, 2) + "\n");
  const count = (collection.item ?? []).reduce(function tally(n, it) {
    return it.item ? it.item.reduce(tally, n) : n + 1;
  }, 0);
  console.log(`postman_collection.json generado: "${collection.info.name}" con ${count} requests.`);
});
