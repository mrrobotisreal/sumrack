import * as Slot from '@rn-primitives/slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { Text as RNText } from 'react-native';

import { cn } from '@/lib/cn';

const textVariants = cva('font-ui text-base text-text', {
  variants: {
    variant: {
      default: '',
      muted: 'text-text-muted',
      caption: 'text-sm text-text-muted',
      title: 'font-ui-bold text-xl',
      heading: 'font-ui-bold text-2xl',
      // Russian story/content text — Literata, reading scale
      reading: 'font-reading text-reading',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

/**
 * Allows a parent (e.g. a future Button) to push text classes down to
 * nested Text children — the react-native-reusables pattern.
 */
const TextClassContext = React.createContext<string | undefined>(undefined);

type TextProps = React.ComponentProps<typeof RNText> &
  VariantProps<typeof textVariants> & { asChild?: boolean };

function Text({ className, variant, asChild = false, ...props }: TextProps) {
  const textClass = React.useContext(TextClassContext);
  const Component = asChild ? Slot.Text : RNText;
  return <Component className={cn(textVariants({ variant }), textClass, className)} {...props} />;
}

export { Text, TextClassContext, textVariants };
