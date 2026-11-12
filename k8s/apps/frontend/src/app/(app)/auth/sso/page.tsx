import { redirect } from 'next/navigation';

export default async function SsoRedirectPage({
  searchParams,
}: {
  // Next 16 hands pages a Promise; awaiting it is what keeps the legacy
  // `/auth/sso?token=` handoff working at runtime.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : undefined;

  redirect(
    token
      ? `/sso?auth_code=${encodeURIComponent(token)}`
      : '/sso'
  );
}
