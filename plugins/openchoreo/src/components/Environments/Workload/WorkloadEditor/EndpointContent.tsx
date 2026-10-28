import { FC, useCallback, useEffect, useMemo } from 'react';
import { Typography } from '@material-ui/core';
import { useEntity } from '@backstage/plugin-catalog-react';
import {
  CHOREO_ANNOTATIONS,
  WorkloadEndpoint,
} from '@openchoreo/backstage-plugin-common';
import {
  EndpointList,
  useEndpointEditBuffer,
} from '@openchoreo/backstage-plugin-react';
import { useWorkloadContext } from '../WorkloadContext';
import type { ComponentEndpointsState } from '../hooks/useComponentEndpoints';
import {
  EndpointExposure,
  chosenEndpointTypeKeys,
  useEndpointTypeSchemas,
} from '../../../../scaffolder/WorkloadDetailsField/EndpointExposure';
import {
  ComponentEndpointExposure,
  DetachedComponentEndpoints,
} from './ComponentEndpointExposure';

const NO_ALLOWED_ENDPOINTS: never[] = [];

interface EndpointContentProps {
  endpoints: { [key: string]: WorkloadEndpoint };
  onEndpointReplace: (
    endpointName: string,
    endpoint: WorkloadEndpoint,
    oldNameToRemove?: string,
  ) => void;
  onAddEndpoint: () => string;
  onRemoveEndpoint: (endpointName: string) => void;
  disabled: boolean;
  /**
   * The component's own Endpoints, shown inside each workload endpoint's row
   * when its ComponentType allows Endpoints or it already has some.
   */
  componentEndpoints?: ComponentEndpointsState;
}

export const EndpointContent: FC<EndpointContentProps> = ({
  endpoints,
  onEndpointReplace,
  onAddEndpoint,
  onRemoveEndpoint,
  disabled,
  componentEndpoints,
}) => {
  const { setEditingSection } = useWorkloadContext();
  const { entity } = useEntity();

  // A renamed workload endpoint keeps its Endpoints.
  const renameWorkloadEndpoint = componentEndpoints?.renameWorkloadEndpoint;
  const handleEndpointReplace = useCallback(
    (
      endpointName: string,
      endpoint: WorkloadEndpoint,
      oldNameToRemove?: string,
    ) => {
      if (oldNameToRemove && oldNameToRemove !== endpointName) {
        renameWorkloadEndpoint?.(oldNameToRemove, endpointName);
      }
      onEndpointReplace(endpointName, endpoint, oldNameToRemove);
    },
    [onEndpointReplace, renameWorkloadEndpoint],
  );

  const editBuffer = useEndpointEditBuffer({
    endpoints,
    onEndpointReplace: handleEndpointReplace,
    onRemoveEndpoint,
  });

  // Report editing state to context
  useEffect(() => {
    setEditingSection('endpoints', editBuffer.isAnyRowEditing);
  }, [editBuffer.isAnyRowEditing, setEditingSection]);

  const showEndpoints = !!componentEndpoints?.enabled;
  const choices = componentEndpoints?.choices;
  const allowedEndpoints = componentEndpoints?.allowedEndpoints;
  const typeKeys = useMemo(
    () =>
      showEndpoints && allowedEndpoints && choices
        ? chosenEndpointTypeKeys(endpoints, allowedEndpoints, choices)
        : [],
    [showEndpoints, endpoints, allowedEndpoints, choices],
  );
  const schemas = useEndpointTypeSchemas(
    typeKeys,
    entity.metadata.annotations?.[CHOREO_ANNOTATIONS.NAMESPACE] ?? '',
  );

  return (
    <>
      {componentEndpoints?.loadError && (
        <Typography variant="body2" color="error" gutterBottom>
          Could not load the component's Endpoints:{' '}
          {componentEndpoints.loadError}
        </Typography>
      )}
      <EndpointList
        endpoints={endpoints}
        disabled={disabled}
        editBuffer={editBuffer}
        onRemoveEndpoint={onRemoveEndpoint}
        onAddEndpoint={onAddEndpoint}
        renderDetails={(_name, endpoint, savedName) =>
          showEndpoints && componentEndpoints ? (
            <ComponentEndpointExposure
              workloadEndpoint={savedName}
              endpoint={endpoint}
              state={componentEndpoints}
              schemas={schemas}
              disabled={disabled}
            />
          ) : (
            // No Endpoints for this component type: say where visibility
            // goes, which is the deprecated workload field.
            <EndpointExposure
              endpoint={endpoint}
              allowedEndpoints={NO_ALLOWED_ENDPOINTS}
              schemas={schemas}
              onChange={() => {}}
            />
          )
        }
      />
      {showEndpoints && componentEndpoints && (
        <DetachedComponentEndpoints
          workloadEndpoints={endpoints}
          state={componentEndpoints}
        />
      )}
    </>
  );
};
