'use client';

import { FC, useState } from 'react';
import useSWR from 'swr';
import { useDebounce } from 'use-debounce';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { useCustomProviderFunction } from '@gitroom/frontend/components/launches/helpers/use.custom.provider.function';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// Search-only location picker shared by TikTok Business and Instagram
// (Facebook Login): 500 ms debounce, Loading / No location found, a result
// list, and a selected card with an X to remove it. The provider binds it to a
// settings key and decides whether the control is visible.
export interface SelectedLocation {
  id: string;
  name: string;
  address?: string;
}

const useLocationSearch = (query: string) => {
  const { integration } = useIntegration();
  const { get } = useCustomProviderFunction();
  const [term] = useDebounce(query, 500);
  const ready = query && query === term && integration?.id;
  const { data, isLoading, error } = useSWR<SelectedLocation[]>(
    ready ? ['locationSearch', integration.id, term] : null,
    ([name, , q]: [string, string, string]) => get(name, { q }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  return {
    results: !error && Array.isArray(data) ? data : [],
    loading: query !== term || isLoading,
  };
};

export const LocationSelector: FC<{
  name: string;
  label: string;
  value?: SelectedLocation;
  onChange: (event: {
    target: {
      value: SelectedLocation | undefined;
      name: string;
    };
  }) => void;
}> = (props) => {
  const { onChange, name, label, value } = props;
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { results, loading } = useLocationSearch(open && !value?.id ? query : '');

  const selectLocation = (location?: SelectedLocation) => {
    setOpen(false);
    onChange({ target: { name, value: location } });
  };

  return (
    <div className="flex flex-col gap-[6px]">
      <div className="text-[14px]">{label}</div>
      {value?.id ? (
        <div className="flex items-center gap-[12px] bg-newBgColorInner border-newTableBorder border rounded-[8px] p-[12px]">
          <div className="flex-1 flex flex-col">
            <div className="text-[14px]">{value.name}</div>
            {!!value.address && (
              <div className="text-[12px] opacity-70">{value.address}</div>
            )}
          </div>
          <div
            className="cursor-pointer text-[14px] opacity-70 hover:opacity-100"
            onClick={() => selectLocation(undefined)}
          >
            X
          </div>
        </div>
      ) : !open ? (
        <div>
          <div
            className="h-[42px] px-[16px] inline-flex items-center cursor-pointer bg-newBgColorInner border-newTableBorder border rounded-[8px] text-[14px]"
            onClick={() => setOpen(true)}
          >
            {t('tiktok_add_location', 'Add location')}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-[6px]">
          <div className="flex gap-[6px]">
            <div className="flex-1 h-[42px] bg-newBgColorInner border-newTableBorder border rounded-[8px] flex items-center">
              <input
                className="h-full w-full bg-transparent outline-none px-[16px] text-[14px] text-textColor placeholder-textColor"
                placeholder={t('tiktok_search_location', 'Search location')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div
              className="h-[42px] px-[16px] flex items-center cursor-pointer bg-newBgColorInner border-newTableBorder border rounded-[8px] text-[14px]"
              onClick={() => setOpen(false)}
            >
              {t('cancel', 'Cancel')}
            </div>
          </div>
          {!!query && (
            <div className="max-h-[250px] overflow-y-auto flex flex-col bg-newBgColorInner border-newTableBorder border rounded-[8px]">
              {loading ? (
                <div className="p-[12px] text-[14px] opacity-70">
                  {t('loading', 'Loading...')}
                </div>
              ) : !results.length ? (
                <div className="p-[12px] text-[14px] opacity-70">
                  {t('tiktok_no_location_found', 'No location found')}
                </div>
              ) : (
                results.map((location) => (
                  <div
                    key={location.id}
                    className="flex flex-col p-[8px] hover:bg-newTableBorder cursor-pointer"
                    onClick={() => selectLocation(location)}
                  >
                    <div className="text-[14px]">{location.name}</div>
                    {!!location.address && (
                      <div className="text-[12px] opacity-70">
                        {location.address}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
