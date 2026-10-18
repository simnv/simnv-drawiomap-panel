import type { Locator } from '@playwright/test';

export async function openEditorSection(inspector: Locator, title: string) {
  const toggle = inspector.getByRole('button', { name: title, exact: true });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
}

export async function chooseEditorOption(inspector: Locator, label: string, option: string) {
  const input = inspector.getByRole('combobox', { name: label, exact: true });
  await input.click();
  await inspector.page().getByRole('option', { name: option, exact: true }).click();
}

export async function selectDiagramElement(inspector: Locator, id: string) {
  const input = inspector.getByRole('combobox', { name: 'Diagram element', exact: true });
  await input.fill(id);
  await inspector.page().getByRole('option', { name: id, exact: true }).click();
}
