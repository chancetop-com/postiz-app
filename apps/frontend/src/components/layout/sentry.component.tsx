'use client';

import { FC, ReactNode, useEffect } from 'react';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { initializeSentryClient } from '@gitroom/react/sentry/initialize.sentry.client';

export const SentryComponent: FC<{ children: ReactNode }> = ({ children }) => {
  const { sentryDsn: dsn, environment, appVersion } = useVariables();

  useEffect(() => {
    if (!dsn) {
      return;
    }

    initializeSentryClient(environment, dsn, appVersion || '0.0.0');
  }, [dsn, environment, appVersion]);

  // Always render children - don't block the app
  return <>{children}</>;
};
