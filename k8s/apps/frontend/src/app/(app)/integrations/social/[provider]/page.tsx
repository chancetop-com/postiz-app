import { ContinueIntegration } from '@gitroom/frontend/components/launches/continue.integration';

export const dynamic = 'force-dynamic';

export default async function Page(
  props: {
    params: Promise<{
      provider: string;
    }>;
    searchParams: Promise<any>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;

  const {
    provider
  } = params;

  return <ContinueIntegration searchParams={searchParams} provider={provider} />;
}
