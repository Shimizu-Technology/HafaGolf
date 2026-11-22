// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LiabilityWaiver } from './LiabilityWaiver';

function renderWaiver(waiverText: string | null) {
  const markup = renderToStaticMarkup(<LiabilityWaiver organizationName="Hillside Golf Club" waiverText={waiverText} />);
  return new DOMParser().parseFromString(markup, 'text/html');
}

describe('LiabilityWaiver', () => {
  it('renders custom paragraphs as plain text', () => {
    const waiver = renderWaiver('First paragraph.\r\n \r\nA <b>literal</b> second paragraph.');

    expect([...waiver.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'First paragraph.', 'A <b>literal</b> second paragraph.',
    ]);
    expect(waiver.querySelector('b')).toBeNull();
  });

  it.each([null, ' \n  '])('uses the organizer’s standard release when custom text is blank', (text) => {
    const waiver = renderWaiver(text);
    expect(waiver.body.textContent).toContain('waive and release Hillside Golf Club');
  });
});
