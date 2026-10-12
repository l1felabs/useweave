const RESET = '\x1b[0m', HIDE = '\x1b[?25l', SHOW = '\x1b[?25h';
const clean = (value) => String(value).replace(/[\x00-\x1f\x7f-\x9f]/g, '');
const tint = (value, color, enabled) => enabled ? `\x1b[38;5;${color}m${value}${RESET}` : value;
const stages = ['runtime', 'identity', 'node', 'mcp', 'clients', 'verify'];
const glyphs = '.:-=+*#';

/** A deterministic protocol illustration. Packets describe motion, never live telemetry. */
export function fabricFrame(width, height, tick = 0, phase = 0, color = true) {
  width = Math.max(24, Math.min(88, Math.floor(width)));
  height = Math.max(8, Math.min(23, Math.floor(height)));
  const cells = Array(width * height).fill(' '), depths = new Float64Array(width * height).fill(-Infinity), colors = new Uint8Array(width * height);
  const angle = -0.48 + Math.sin(tick / 28) * 0.09, ca = Math.cos(angle), sa = Math.sin(angle);
  const plot = (x, y, z, char, hue = 245) => {
    const rx = x * ca + z * sa, rz = z * ca - x * sa;
    const perspective = 1 / (1 - rz * 0.11);
    const px = Math.round(width / 2 + rx * perspective * width * 0.19);
    const py = Math.round(height / 2 - (y * 0.78 - rz * 0.29) * perspective * height * 0.31);
    if (px < 0 || px >= width || py < 0 || py >= height) return;
    const i = py * width + px;
    if (rz < depths[i]) return;
    depths[i] = rz; cells[i] = char; colors[i] = hue;
  };
  // Registration planes below, within and above the fabric.
  for (const y of [-1.34, 0, 1.34]) {
    for (let i = 0; i <= 70; i++) {
      const p = i / 70 * 3.9 - 1.95;
      plot(p, y, -1.08, '.', 240); plot(p, y, 1.08, '.', 240);
      plot(-1.95, y, p * 0.55, '.', 240); plot(1.95, y, p * 0.55, '.', 240);
    }
  }
  // Counter-wound filaments cross around a signed central spine.
  const count = width < 50 ? 22 : 38;
  for (let strand = 0; strand < count; strand++) {
    const offset = strand / count * Math.PI * 2;
    const handed = strand % 2 ? 1 : -1;
    for (let i = 0; i < 100; i++) {
      const t = i / 99, y = (t - 0.5) * 3.65;
      const radius = 0.80 + 0.48 * Math.pow(Math.sin(t * Math.PI), 2);
      const a = offset + t * Math.PI * 2.1 * handed;
      const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      const shade = glyphs[Math.round((z / radius + 1) * 0.5 * (glyphs.length - 1))];
      const active = strand % 6 === phase % 6;
      plot(x, y, z, shade, active ? (handed > 0 ? 81 : 141) : z > 0 ? 250 : 240);
      if (active && Math.abs((t + strand * 0.037 - tick / 70) % 1) < 0.016) plot(x, y, z + 0.02, '@', 159);
    }
  }
  // Individually composed peer modules, not a globe or starfield.
  for (let i = 0; i < 18; i++) {
    const a = i * 2.399963, y = (i % 6 - 2.5) * 0.52;
    const x = Math.cos(a) * (1.50 + (i % 3) * 0.15), z = Math.sin(a) * 1.18;
    const hue = i % 6 === phase % 6 ? 117 : 246;
    plot(x - 0.10, y, z, '[', hue); plot(x, y, z, i % 3 === 0 ? '+' : ':', hue); plot(x + 0.10, y, z, ']', hue);
  }
  for (let i = 0; i < 7; i++) {
    const y = (i - 3) * 0.45;
    plot(-0.14, y, 1.33, '[', 147); plot(0, y, 1.34, phase === 1 || phase === 5 ? '#' : '=', 153); plot(0.14, y, 1.33, ']', 147);
    if (i < 6) plot(0, y + 0.22, 1.32, '|', 245);
  }
  const lines = [];
  for (let y = 0; y < height; y++) {
    let line = '', last = -1;
    for (let x = 0; x < width; x++) {
      const i = y * width + x, hue = colors[i];
      if (color && hue !== last) { line += hue ? `\x1b[38;5;${hue}m` : RESET; last = hue; }
      line += cells[i];
    }
    lines.push(color ? `${line}${RESET}` : line);
  }
  return lines;
}

export class TerminalPresenter {
  constructor({ stream = process.stderr, env = process.env, json = false, noAnimation = false, timers = globalThis } = {}) {
    this.stream = stream; this.json = json; this.timers = timers;
    this.color = !Object.hasOwn(env, 'NO_COLOR') && env.TERM !== 'dumb';
    this.animated = !json && !noAnimation && Boolean(stream.isTTY) && env.TERM !== 'dumb';
    this.active = false; this.closed = false; this.height = 0; this.tick = 0;
    this.phase = 0; this.label = 'Preparing your developer runtime'; this.completed = [];
    this.resize = () => { if (this.active) this.render(); };
    if (this.animated) stream.on?.('resize', this.resize);
  }
  start() {
    if (!this.animated || this.closed || this.active) return;
    this.active = true;
    this.stream.write(HIDE);
    this.render();
    this.timer = this.timers.setInterval(() => { this.tick++; this.render(); }, 120);
    this.timer?.unref?.();
  }
  stage({ id, label }) {
    this.phase = Math.max(0, stages.indexOf(id)); this.label = clean(label);
    if (this.animated) { if (!this.active) this.start(); else this.render(); }
    else if (!this.json && !this.closed) this.stream.write(`\n> ${this.label}\n`);
  }
  progress(message) {
    const text = clean(message);
    this.completed.push(text);
    if (this.active) this.render();
    else if (!this.json && !this.closed) this.stream.write(`  + ${text}\n`);
  }
  render() {
    if (!this.active || this.closed) return;
    const columns = Math.max(1, Math.floor(this.stream.columns || 80));
    const width = Math.min(88, columns - 2), rows = Math.floor(this.stream.rows || 36);
    // Tiny terminals use readable status, rather than clipping a sculpture.
    const title = width >= 48 ? 'W E A V E   /   THE AGENT-NATIVE WEB' : 'W E A V E';
    const lines = [tint(title.slice(0, columns - 1), 147, this.color)];
    if (width >= 26 && rows >= 17) lines.push(...fabricFrame(width, Math.min(23, rows - 11), this.tick, this.phase, this.color));
    lines.push('', tint(this.label.slice(0, columns - 1), 159, this.color));
    const trace = stages.map((id, i) => i === this.phase ? `[${id}]` : id).join(' / ');
    if (trace.length < columns) lines.push(tint(trace, 245, this.color));
    const recent = this.completed.slice(-2);
    for (const message of recent) lines.push(`+ ${message}`.slice(0, columns - 1));
    if (width >= 44) lines.push(tint('Protocol illustration  |  real installation stages'.slice(0, columns - 1), 240, this.color));
    if (rows < 7) lines.splice(0, lines.length, tint(this.label.slice(0, columns - 1), 159, this.color));
    this.clear();
    for (const line of lines) this.stream.write(`\r\x1b[2K${line}\n`);
    this.widths = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, '').length);
    this.height = lines.length;
  }
  clear() {
    if (!this.height) return;
    const columns = Math.max(1, Math.floor(this.stream.columns || 80));
    const priorRows = this.widths?.reduce((sum, width) => sum + Math.max(1, Math.ceil(width / columns)), 0) || this.height;
    // Reflow may put old illustration lines into scrollback. Clear only the
    // currently visible owned region; never scroll a tall blank frame through
    // a newly tiny terminal.
    const height = Math.min(priorRows, Math.max(1, Math.floor(this.stream.rows || 36) - 1));
    this.stream.write(`\x1b[${height}A`);
    for (let i = 0; i < height; i++) this.stream.write('\r\x1b[2K\n');
    this.stream.write(`\x1b[${height}A\r`);
    this.height = 0;
  }
  pause() {
    if (this.timer !== undefined) { this.timers.clearInterval(this.timer); this.timer = undefined; }
    this.active = false;
    if (this.animated) { this.clear(); this.stream.write(`${RESET}${SHOW}`); }
  }
  resume() { this.start(); }
  finish() {
    if (this.closed) return;
    this.pause(); this.closed = true;
    if (this.animated) this.stream.off?.('resize', this.resize);
  }
}

const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
export function installationSummary(result) {
  const cli = result.pathAdded ? 'weave' : quote(result.binary);
  const lines = ['Weave is ready.', ''];
  for (const component of result.components || []) {
    const status = component.status === 'installed' || component.status === 'ready' ? '+' : component.status === 'running' ? '+' : '-';
    lines.push(`${status} ${component.name}${component.version ? ` ${component.version}` : ''}  /  ${component.status}${component.id === 'node' ? ` (${component.managed ? 'user service' : 'detached'})` : ''}`);
  }
  lines.push('', `Workspace: ${result.shared}`, `Private identity and data: ${result.workspace}`, `Agent clients: ${result.mcpClients.length ? result.mcpClients.join(', ') : 'none configured; consent is required'}`, '', 'Your next thread:', `  ${cli} node status --json`, `  ${cli} strand create --json`, '', 'Docs: https://docs.weave.earth/getting-started/quickstart', 'Your identity stays local. No account or desktop app was installed.');
  if (!result.pathAdded) lines.push('Add the CLI to PATH with a consented rerun: npx joinweave@0.1.3 --yes --path');
  return lines.map(clean).join('\n');
}
