import { TestBed } from '@angular/core/testing';

import { ShareService } from './share.service';

const plugin = {
  canShare: jest.fn(async () => ({ value: true })),
  share: jest.fn(async () => ({ activityType: '' })),
};

jest.mock('@capacitor/share', () => ({
  Share: {
    canShare: (...a: unknown[]) => plugin.canShare(...(a as [])),
    share: (...a: unknown[]) => plugin.share(...(a as [])),
  },
}));

describe('ShareService', () => {
  let service: ShareService;

  beforeEach(() => {
    jest.clearAllMocks();
    TestBed.configureTestingModule({});
    service = TestBed.inject(ShareService);
  });

  it('unwraps the plugin capability result', async () => {
    await expect(service.canShare()).resolves.toBe(true);
    plugin.canShare.mockResolvedValueOnce({ value: false });
    await expect(service.canShare()).resolves.toBe(false);
  });

  it('defaults the dialog title to the share title', async () => {
    await service.shareText({ title: 'My roster', text: 'Mon 06:00-14:00' });

    expect(plugin.share).toHaveBeenCalledWith({
      title: 'My roster',
      text: 'Mon 06:00-14:00',
      dialogTitle: 'My roster',
    });
  });

  it('honours an explicit dialog title', async () => {
    await service.shareText({ title: 'My roster', text: 'x', dialogTitle: 'Send roster to' });
    expect(plugin.share).toHaveBeenCalledWith(expect.objectContaining({ dialogTitle: 'Send roster to' }));
  });
});
