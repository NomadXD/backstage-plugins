import { fireEvent, render, screen } from '@testing-library/react';
import { EndpointStrategyField } from './EndpointStrategyField';

const backend = (component: string) => ({
  name: `${component}-http`,
  component,
  endpoint: 'http',
});

function renderField(backends: unknown[], formData?: string) {
  const onChange = jest.fn();
  render(
    <EndpointStrategyField
      {...({
        formData,
        onChange,
        formContext: { formData: { backends } },
        uiSchema: { 'ui:options': { backendsField: 'backends' } },
      } as any)}
    />,
  );
  return onChange;
}

describe('EndpointStrategyField', () => {
  it('stays hidden until the Endpoint has two backends', () => {
    renderField([backend('orders')]);
    expect(screen.queryByLabelText('How traffic moves')).toBeNull();
  });

  it('splits by weight by default and offers the strategies', () => {
    const onChange = renderField([backend('orders'), backend('orders-v2')]);
    expect(
      screen.getByText('Each backend gets the share its weight gives it.'),
    ).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByLabelText('How traffic moves'));
    fireEvent.click(screen.getByRole('option', { name: 'Canary' }));
    expect(onChange).toHaveBeenCalledWith('canary');
  });

  it('goes back to weights when a backend is removed', () => {
    const onChange = renderField([backend('orders')], 'canary');
    expect(onChange).toHaveBeenCalledWith('weight');
  });
});
