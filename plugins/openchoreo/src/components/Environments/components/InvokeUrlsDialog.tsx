import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  IconButton,
  Tooltip,
  Divider,
  Chip,
} from '@material-ui/core';
import { useTheme } from '@material-ui/core/styles';
import FileCopyOutlinedIcon from '@material-ui/icons/FileCopyOutlined';
import type {
  EndpointInfo,
  EndpointURLDetails,
  EndpointURLSecurity,
} from '../hooks/useEnvironmentData';
import {
  buildUrl,
  describeSecurity,
  projectUrlOf,
} from '../utils/invokeUrlUtils';

interface URLRowProps {
  url: string;
  label: string;
  /** What a caller must present, for URLs that come from an Endpoint. */
  security?: EndpointURLSecurity;
}

const URLRow = ({ url, label, security }: URLRowProps) => {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Box mb={1.5}>
      <Box display="flex" alignItems="center" mb={0.5}>
        <Chip
          label={label}
          size="small"
          style={{ fontSize: '0.7rem', height: 20 }}
        />
        {describeSecurity(security) && (
          <Chip
            label={describeSecurity(security)}
            size="small"
            variant="outlined"
            style={{ fontSize: '0.7rem', height: 20, marginLeft: 6 }}
          />
        )}
      </Box>
      <Box display="flex" alignItems="flex-start">
        <Box
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.04)',
            borderRadius: 4,
            padding: '6px 8px',
          }}
        >
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontFamily: 'monospace',
              fontSize: '0.8rem',
              wordBreak: 'break-all',
              color: theme.palette.primary.main,
              textDecoration: 'none',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.textDecoration =
                'underline';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.textDecoration = 'none';
            }}
          >
            {url}
          </a>
        </Box>
        <Tooltip
          title={copied ? 'Copied!' : 'Copy URL'}
          open={copied ? true : undefined}
          leaveDelay={copied ? 0 : 200}
        >
          <IconButton
            size="small"
            onClick={handleCopy}
            aria-label="Copy URL"
            style={{ marginLeft: 4, flexShrink: 0 }}
          >
            <FileCopyOutlinedIcon style={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
};

const urlRows = (
  urls: Record<string, EndpointURLDetails> | undefined,
  label: string,
  keyPrefix: string,
) =>
  Object.entries(urls ?? {}).map(([protocol, details]) => (
    <URLRow
      key={`${keyPrefix}-${protocol}`}
      url={buildUrl(details)}
      label={label}
      security={details.security}
    />
  ));

interface InvokeUrlsDialogProps {
  open: boolean;
  onClose: () => void;
  endpoints: EndpointInfo[];
}

export const InvokeUrlsDialog = ({
  open,
  onClose,
  endpoints,
}: InvokeUrlsDialogProps) => {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="invoke-urls-dialog-title"
    >
      <DialogTitle id="invoke-urls-dialog-title">Endpoint URLs</DialogTitle>
      <DialogContent dividers>
        {endpoints.length === 0 ? (
          <Typography variant="body2" color="textSecondary">
            No invoke URLs available.
          </Typography>
        ) : (
          endpoints.map((endpoint, idx) => (
            <Box key={endpoint.name} mb={idx < endpoints.length - 1 ? 3 : 0}>
              <Box display="flex" alignItems="center" mb={1}>
                <Typography variant="subtitle2" style={{ fontWeight: 600 }}>
                  {endpoint.name}
                </Typography>
                {endpoint.type && (
                  <Typography
                    variant="caption"
                    color="textSecondary"
                    style={{ marginLeft: 8 }}
                  >
                    ({endpoint.type})
                  </Typography>
                )}
                {endpoint.endpointName && (
                  <Typography
                    variant="caption"
                    color="textSecondary"
                    style={{ marginLeft: 8 }}
                  >
                    via Endpoint {endpoint.endpointName}
                  </Typography>
                )}
              </Box>
              <Divider style={{ marginBottom: 12 }} />

              {urlRows(endpoint.externalURLs, 'External', 'ext')}
              {urlRows(endpoint.internalURLs, 'Internal', 'int')}
              {urlRows(endpoint.namespaceURLs, 'Namespace', 'ns')}
              {projectUrlOf(endpoint) && (
                <URLRow
                  url={projectUrlOf(endpoint)!}
                  label="Project"
                  security={endpoint.projectURL?.security}
                />
              )}
            </Box>
          ))
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="primary">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};
