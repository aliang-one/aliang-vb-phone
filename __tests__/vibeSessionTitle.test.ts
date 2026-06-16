import { formatVibeSessionTitle } from '../src/utils/vibeSessionTitle';

describe('vibeSessionTitle', () => {
  it('renders template-only titles into readable summaries', () => {
    const title = formatVibeSessionTitle(
      '<environment-context><cwd><shell><current_date><timezone><filesystem><workspace>',
      {
        directory: '/Users/mac/MyProgram/AiProgram/vibe_on_phone/app',
        workspace: 'vibe_on_phone',
        shell: 'zsh',
        timezone: 'Asia/Shanghai',
        currentDate: new Date('2026-06-16T10:00:00.000Z'),
        filesystem: 'APFS',
      },
    );

    expect(title).toContain('vibe_on_phone');
    expect(title).toContain('zsh');
    expect(title).toContain('2026-06-16');
    expect(title).toContain('Asia/Shanghai');
    expect(title).toContain('APFS');
  });

  it('replaces template tags inside mixed titles', () => {
    const title = formatVibeSessionTitle('Fixing <workspace> on <cwd>', {
      directory: '/Users/mac/MyProgram/AiProgram/vibe_on_phone',
      workspace: 'vibe_on_phone',
    });

    expect(title).toBe('Fixing vibe_on_phone on vibe_on_phone');
  });
});
