// Controlled source grammar; this is not a replacement for the frozen GOV page.
export const tableCss = `html,body{margin:0;background:white}body{padding:30px;font:400 19px/1.3157894736842106 Arial;color:#0b0c0c}dl{display:table;table-layout:fixed;border-collapse:collapse;border-spacing:0;width:100%;margin:0}dl>div{display:table-row;border-bottom:1px solid #cecece}dt,dd{display:table-cell;box-sizing:content-box;vertical-align:top;padding:10px 0;margin:0}dt{width:30%;padding-right:20px;font-weight:700}dd{width:auto}p{margin:0 0 10px}p:last-child{margin-bottom:0}`;
export const tableRows = [
  ['Name', '\n    Sarah Phillips\n  '],
  ['Date of birth', '5 January 1978'],
  ['Address', '72 Guild Street<br>London<br>SE23 6FH'],
  ['Contact details', '<p>07700 900457</p><p>sarah.phillips@example.com</p>'],
];
export const tableHtml = (rows = tableRows) => `<dl>${rows.map(([key,value],index)=>`<div id="row-${index}"><dt>${key}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
export const tablePage = (rows = tableRows, extraCss = '') => `<!doctype html><style>${tableCss}${extraCss}</style><body>${tableHtml(rows)}</body>`;
