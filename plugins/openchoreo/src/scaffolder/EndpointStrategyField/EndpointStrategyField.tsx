import { useEffect } from 'react';
import { MenuItem, TextField } from '@material-ui/core';
import { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import type { RolloutStrategy } from '@openchoreo/backstage-plugin-common';
import { STRATEGY_COPY } from '../../components/EndpointEnvironments/progressive/endpointRolloutUi';

export type EndpointStrategyValue = 'weight' | RolloutStrategy;

const HOW: Record<EndpointStrategyValue, string> = {
  weight: 'Each backend gets the share its weight gives it.',
  canary:
    'The second backend is the new version, at 0%. Testers reach it with x-canary: true; step it up on the Deploy tab.',
  blueGreen:
    'The second backend is the new version, at 0%. Testers reach it with x-preview: green; switch everyone on the Deploy tab.',
  abTest:
    'The second backend is the new version, for the users with the experiment cookie; ship it to everyone on the Deploy tab.',
  mirror:
    'The second backend is the new version. It gets a copy of every request, and nobody sees its answers.',
};

/**
 * How traffic moves to the second backend of a new Endpoint: split by the
 * weights, or a progressive delivery strategy that starts the second backend
 * at 0%. Shown only when the Endpoint has exactly two backends.
 */
export const EndpointStrategyField = ({
  formData,
  onChange,
  formContext,
  uiSchema,
}: FieldExtensionComponentProps<EndpointStrategyValue>) => {
  const backendsField =
    (uiSchema?.['ui:options']?.backendsField as string) ?? 'backends';
  const backends: unknown[] = formContext?.formData?.[backendsField] ?? [];
  const offered = backends.length === 2;
  const value = formData ?? 'weight';

  useEffect(() => {
    if (!offered && value !== 'weight') onChange('weight');
  }, [offered, value, onChange]);

  if (!offered) return null;
  return (
    <TextField
      select
      fullWidth
      size="small"
      variant="outlined"
      label="How traffic moves"
      value={value}
      onChange={e => onChange(e.target.value as EndpointStrategyValue)}
      helperText={HOW[value]}
      SelectProps={{
        SelectDisplayProps: { 'aria-label': 'How traffic moves' } as any,
      }}
    >
      <MenuItem value="weight">Split by weight</MenuItem>
      {(['canary', 'blueGreen', 'abTest', 'mirror'] as const).map(s => (
        <MenuItem key={s} value={s}>
          {STRATEGY_COPY[s].name}
        </MenuItem>
      ))}
    </TextField>
  );
};

export const EndpointStrategyFieldSchema = {
  returnValue: { type: 'string' as const },
};
