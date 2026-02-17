const axios = require('axios');
async function test() {
  const r = await axios.get('https://www.gonutre.com', {timeout:5000, headers:{'User-Agent':'Mozilla/5.0'}});
  const html = r.data;
  console.log('HTML length:', html.length);
  console.log('First 500 chars:', html.slice(0,500));
  console.log('---');
  console.log('Contains noscript:', html.includes('noscript'));
  console.log('Contains __NEXT:', html.includes('__NEXT'));
  console.log('Contains react:', html.toLowerCase().includes('react'));
}
test();
