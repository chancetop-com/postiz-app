import { afterEach, expect, it, vi } from 'vitest';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';

afterEach(() => vi.unstubAllEnvs());

it('stops after three mail provider failures and lets the caller continue', async () => {
  vi.stubEnv('EMAIL_FROM_ADDRESS', 'synthetic@postiz.invalid');
  vi.stubEnv('EMAIL_FROM_NAME', 'Synthetic Postiz');
  vi.stubEnv('EMAIL_PROVIDER', 'empty');

  const service = new EmailService({} as never);
  const sendEmail = vi.fn().mockRejectedValue(new Error('provider outage'));
  Object.assign(service, { emailService: { sendEmail } });

  await expect(
    service.sendEmailSync('somebody@synthetic.invalid', 'subject', '<p>x</p>')
  ).resolves.toBeUndefined();
  expect(sendEmail).toHaveBeenCalledTimes(3);
});
