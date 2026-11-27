import { createContext, FC, ReactNode, useContext } from 'react';
import { Post } from '@prisma/client';
import type { BrowserDraftEditor } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
const ExistingDataContext = createContext({
  integration: '',
  draftEditor: undefined as BrowserDraftEditor | undefined,
  group: undefined as undefined | string,
  posts: [] as Post[],
  settings: {} as any,
  // the other channels the post was created with
  siblings: undefined as
    | undefined
    | {
        integration: string;
        draftEditor?: BrowserDraftEditor;
        group: string;
        posts: Post[];
        settings: any;
      }[],
});
export const ExistingDataContextProvider: FC<{
  children: ReactNode;
  value: any;
}> = ({ children, value }) => {
  return (
    <ExistingDataContext.Provider value={value}>
      {children}
    </ExistingDataContext.Provider>
  );
};
export const useExistingData = () => useContext(ExistingDataContext);
