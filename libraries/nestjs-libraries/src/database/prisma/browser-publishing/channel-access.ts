import type { Prisma } from '@prisma/client';

// The composite foreign key requires the binding and the integration to belong to the same organization.
export const availableBrowserChannel: Prisma.IntegrationWhereInput = {
  browserBinding: { active: true, merchant: { enabled: true } },
  disabled: false,
  deletedAt: null,
};

export const postableChannel: Prisma.IntegrationWhereInput = {
  OR: [
    {
      browserBindingId: null,
      NOT: { providerIdentifier: { startsWith: 'browser-' } },
    },
    availableBrowserChannel,
  ],
};

export function browserTargetAllowed(
  provider: string | undefined,
  noPublish: unknown,
  developmentEnabled: boolean
) {
  if (noPublish !== undefined && typeof noPublish !== 'boolean') return false;
  return provider === 'local-chrome' ? developmentEnabled : noPublish !== true;
}
