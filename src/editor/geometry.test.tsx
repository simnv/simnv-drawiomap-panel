import React, { useMemo, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BindingEditor } from './BindingEditor';
import { buildCellIndex, mountSvg } from '../render/svgStage';
import { EMPTY_CONFIG } from './draft';
import type { Diagram } from '../types';
vi.hoisted(() => {
  if (!window.localStorage) {
    Object.defineProperty(window, 'localStorage', { value: { getItem: () => null, setItem() {}, removeItem() {} } });
  }
  window.matchMedia =
    window.matchMedia ?? ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never);
});

vi.mock('@grafana/runtime', async (original) => ({
  ...(await original<typeof import('@grafana/runtime')>()),
  getDataSourceSrv: () => ({ get: async () => ({ components: {} }), getInstanceSettings: () => undefined }),
}));

/** Waits for the editor frame (it comes after the probe of the editor files) and opens its channel. */
async function editorChannel() {
  const frame = (await screen.findByTitle('draw.io')) as HTMLIFrameElement;
  const doc = new DOMParser().parseFromString(frame.srcdoc, 'text/html');
  const token = doc.querySelector('meta[name="dmap-channel"]')!.getAttribute('content');
  const port = {
    onmessage: undefined as ((event: { data: string }) => void) | undefined,
    postMessage: vi.fn(),
    close: vi.fn(),
  };
  act(() =>
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'null',
        source: frame.contentWindow,
        data: JSON.stringify({ dmapHello: token }),
        ports: [port as unknown as MessagePort],
      })
    )
  );
  const send = (event: unknown) => act(() => port.onmessage?.({ data: JSON.stringify(event) }));
  return { port, send };
}

describe('draw.io geometry draft', () => {
  beforeEach(() => {
    // The probe of the editor files (availability.ts) gets a JavaScript file.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { headers: { 'content-type': 'text/javascript' } }))
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens geometry with existing identities, previews a save, and restores geometry on cancel before Apply', async () => {
    const original: Diagram = {
      xml: '<mxfile><diagram id="original"/></mxfile>',
      hash: 'original',
      updatedAt: '',
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><g data-cell-id="region"><rect width="180" height="70"/></g></svg>',
    };
    const save = vi.fn();
    const preview = vi.fn();
    function Harness() {
      const [diagram, setDiagram] = useState(original);
      const cells = useMemo(() => buildCellIndex(mountSvg(document.createElement('div'), diagram.svg)), [diagram]);
      return (
        <BindingEditor
          config={EMPTY_CONFIG}
          diagram={original}
          cells={cells}
          onSave={save}
          onDiagramPreview={(value) => {
            preview(value);
            setDiagram(value);
          }}
        />
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit geometry in draw.io' }));
    const channel = await editorChannel();
    channel.send({ event: 'init' });
    expect(JSON.parse(channel.port.postMessage.mock.calls[0][0]).xml).toBe(original.xml);
    const changed = { xml: '<mxfile><diagram id="changed"/></mxfile>', svg: original.svg.replace('180', '260') };
    channel.send({ event: 'save', xml: changed.xml, exit: true });
    channel.send({ event: 'export', data: `data:image/svg+xml,${encodeURIComponent(changed.svg)}` });
    expect(preview.mock.calls.at(-1)?.[0]).toMatchObject(changed);
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel changes' }));
    expect(preview.mock.calls.at(-1)?.[0]).toEqual(original);
    fireEvent.click(screen.getByRole('button', { name: 'Edit geometry in draw.io' }));
    const second = await editorChannel();
    second.send({ event: 'save', xml: changed.xml, exit: true });
    second.send({ event: 'export', data: `data:image/svg+xml,${encodeURIComponent(changed.svg)}` });
    fireEvent.click(screen.getByRole('button', { name: 'Apply bindings' }));
    expect(save.mock.calls[0][1]).toMatchObject(changed);
    expect(buildCellIndex(mountSvg(document.createElement('div'), save.mock.calls[0][1].svg)).has('region')).toBe(true);
  });
});
