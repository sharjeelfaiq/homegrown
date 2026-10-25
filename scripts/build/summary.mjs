const STATUS = {
  success: { heading: 'BUILD SUCCEEDED', color: '\x1b[32m' },
  failure: { heading: 'BUILD FAILED', color: '\x1b[31m' },
  cancelled: { heading: 'BUILD CANCELLED', color: '\x1b[33m' },
};

const RESET = '\x1b[0m';
const MUTED = '\x1b[90m';
const CYAN = '\x1b[36m';
const RULE = '-'.repeat(44);

export function renderBuildSummary({ status, duration, fields, color = false }) {
  const style = STATUS[status];
  if (!style) throw new TypeError(`Unknown build summary status: ${status}`);

  const labelWidth = Math.max('Duration'.length, ...fields.map(({ label }) => label.length));
  const heading = color ? `${style.color}${style.heading}${RESET}` : style.heading;
  const rule = color ? `${MUTED}${RULE}${RESET}` : RULE;
  const rows = fields.map(({ label, value, accent = false }) => {
    const renderedValue = color && accent ? `${CYAN}${value}${RESET}` : value;
    return `  ${label.padEnd(labelWidth)}  ${renderedValue}`;
  });

  return [heading, rule, `  ${'Duration'.padEnd(labelWidth)}  ${duration}`, ...rows, rule, ''].join('\n');
}
