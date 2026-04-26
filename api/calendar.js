// Vercel API Route：代理 Google Apps Script，解決 CORS 問題
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');

  const GAS_URL = "https://script.google.com/macros/s/AKfycbw2TbDcDvTgQXKXY7eeJyZ1ImGoZmx4elcX73TyM4Yru56XJ185XU7fB2sdJmarLU_XUw/exec";

  try {
    const r = await fetch(GAS_URL, { redirect: "follow" });
    const json = await r.json();
    res.status(200).json(json);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}
