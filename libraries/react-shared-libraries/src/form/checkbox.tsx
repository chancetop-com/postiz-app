'use client';

import { forwardRef, KeyboardEvent, useCallback } from 'react';
import clsx from 'clsx';
import { useFormContext } from 'react-hook-form';
export const Checkbox = forwardRef<
  null,
  {
    checked?: boolean;
    disabled?: boolean;
    disableForm?: boolean;
    name?: string;
    className?: string;
    label?: string;
    onChange?: (event: {
      target: {
        name?: string;
        value: boolean;
      };
    }) => void;
    variant?: 'default' | 'hollow';
  }
>((props, ref: any) => {
  const { checked, className, label, disableForm, disabled, name, onChange } =
    props;
  const form = useFormContext();
  const registered = disableForm ? {} : form.register(name!);
  const watch = disableForm ? false : form.watch(name!);
  const val = Boolean(watch || checked);

  const changeStatus = useCallback(() => {
    if (disabled) {
      return;
    }
    onChange?.({
      target: {
        name: name!,
        value: !val,
      },
    });
    if (!disableForm) {
      form.register(name!).onChange({
        target: {
          name: name!,
          value: !val,
        },
      });
    }
  }, [val, disabled, onChange, name, disableForm, form]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        changeStatus();
      }
    },
    [changeStatus]
  );

  return (
    <div
      className={clsx(
        'group flex w-fit items-center gap-[8px]',
        disabled && 'opacity-50'
      )}
    >
      <div
        ref={ref}
        {...registered}
        role="checkbox"
        aria-checked={val}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        onClick={changeStatus}
        onKeyDown={handleKeyDown}
        className={clsx(
          'select-none w-[18px] h-[18px] min-w-[18px] min-h-[18px] rounded-[5px] border-[1.5px] justify-center items-center flex transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-btnPrimary focus-visible:ring-offset-1 focus-visible:ring-offset-newBgColorInner',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
          val
            ? 'bg-btnPrimary border-btnPrimary text-white'
            : clsx(
                'bg-newBgColorInner border-newTextColor/25',
                !disabled && 'group-hover:border-btnPrimary'
              ),
          className
        )}
      >
        {val && (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 14 14"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="2.5 7.2 5.5 10.2 11.5 3.8" />
          </svg>
        )}
      </div>
      {!!label && (
        <div
          onClick={changeStatus}
          className={clsx(
            'text-[14px] leading-[20px] select-none',
            disabled ? 'cursor-not-allowed' : 'cursor-pointer'
          )}
        >
          {label}
        </div>
      )}
    </div>
  );
});
