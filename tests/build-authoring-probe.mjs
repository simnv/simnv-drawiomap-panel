// This is a research harness, never part of the production module.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const panel = 'src/components/DrawioMapPanel.tsx';
const rules = 'src/options/RulesEditor.tsx';
const temporary = 'src/authoringCompatibilityProbe.tsx';
const originals = new Map([panel, rules].map((file) => [file, fs.readFileSync(file, 'utf8')]));
if (fs.existsSync(temporary)) {
  throw new Error(`Refusing to overwrite ${temporary}`);
}
try {
  fs.copyFileSync('tests/authoring-compat.probe.tsx', temporary);
  fs.writeFileSync(
    panel,
    `import { PanelProbe } from '../authoringCompatibilityProbe';\n` +
      originals.get(panel).replace('export function DrawioMapPanel(', 'function OriginalDrawioMapPanel(') +
      '\nexport function DrawioMapPanel(props: PanelProps<Options>) { return <PanelProbe {...props} renderPanel={OriginalDrawioMapPanel} />; }\n'
  );
  fs.writeFileSync(
    rules,
    `import { OptionsProbe } from '../authoringCompatibilityProbe';\n` +
      originals
        .get(rules)
        .replace(
          'export function RulesEditor({ value, onChange }: Props)',
          'export function RulesEditor({ value, onChange, context }: Props)'
        )
        .replace(
          "<RadioButtonGroup<'form' | 'yaml'>",
          "<OptionsProbe context={context} /><RadioButtonGroup<'form' | 'yaml'>"
        )
  );
  const check = spawnSync('npm', ['run', 'typecheck'], { stdio: 'inherit' });
  if (check.status !== 0) {
    throw new Error('Probe typecheck failed');
  }
  const result = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  for (const [file, original] of originals) {
    fs.writeFileSync(file, original);
  }
  fs.rmSync(temporary, { force: true });
}
