import { locationService } from '@grafana/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentAddress, requestOpen, subscribe } from './popupBus';

const address = { pathname: '/d/abc/demo', editPanel: '2' };

describe('popupBus', () => {
  const stops: Array<() => void> = [];
  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
    locationService.push('/');
  });

  it('delivers a request to the subscriber of the same address', () => {
    const listener = vi.fn();
    stops.push(subscribe(address, listener));
    expect(requestOpen({ ...address }, { kind: 'none' })).toBe(true);
    expect(listener).toHaveBeenCalledWith({ kind: 'none' });
  });

  it('drops a request for another panel or another dashboard', () => {
    const listener = vi.fn();
    stops.push(subscribe(address, listener));
    expect(requestOpen({ ...address, editPanel: '3' }, { kind: 'none' })).toBe(false);
    expect(requestOpen({ ...address, pathname: '/d/other/demo' }, { kind: 'none' })).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('returns false without a subscriber', () => {
    expect(requestOpen(address, { kind: 'none' })).toBe(false);
  });

  it('stops delivering after cleanup', () => {
    const listener = vi.fn();
    const stop = subscribe(address, listener);
    stop();
    expect(requestOpen(address, { kind: 'cell', cellId: 'a' })).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps the other subscribers of an address when one stops', () => {
    const first = vi.fn();
    const second = vi.fn();
    const stop = subscribe(address, first);
    stops.push(subscribe(address, second));
    stop();
    expect(requestOpen(address, { kind: 'query', queryId: 'q' })).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ kind: 'query', queryId: 'q' });
  });

  it('reads the address from the Grafana location', () => {
    locationService.push('/d/abc/demo?editPanel=2');
    expect(currentAddress()).toEqual(address);
    locationService.push('/d/abc/demo');
    expect(currentAddress()).toEqual({ pathname: '/d/abc/demo', editPanel: '' });
  });
});
