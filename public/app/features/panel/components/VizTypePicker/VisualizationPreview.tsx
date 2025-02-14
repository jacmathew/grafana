import React, { CSSProperties } from 'react';
import { GrafanaTheme2, PanelData, VisualizationSuggestion } from '@grafana/data';
import { PanelRenderer } from '../PanelRenderer';
import { css } from '@emotion/css';
import { Tooltip, useStyles2 } from '@grafana/ui';
import { VizTypeChangeDetails } from './types';
import { cloneDeep } from 'lodash';
import { selectors } from '@grafana/e2e-selectors';

export interface Props {
  data: PanelData;
  width: number;
  suggestion: VisualizationSuggestion;
  showTitle?: boolean;
  onChange: (details: VizTypeChangeDetails) => void;
}

export function VisualizationPreview({ data, suggestion, onChange, width, showTitle }: Props) {
  const styles = useStyles2(getStyles);
  const { innerStyles, outerStyles, renderWidth, renderHeight } = getPreviewDimensionsAndStyles(width);

  const onClick = () => {
    onChange({
      pluginId: suggestion.pluginId,
      options: suggestion.options,
      fieldConfig: suggestion.fieldConfig,
    });
  };

  let preview = suggestion;
  if (suggestion.previewModifier) {
    preview = cloneDeep(suggestion);
    suggestion.previewModifier(preview);
  }

  return (
    <div>
      {showTitle && <div className={styles.name}>{suggestion.name}</div>}
      <button
        aria-label={suggestion.name}
        className={styles.vizBox}
        data-testid={selectors.components.VisualizationPreview.card(suggestion.name)}
        style={outerStyles}
        onClick={onClick}
      >
        <Tooltip content={suggestion.name}>
          <div style={innerStyles} className={styles.renderContainer}>
            <PanelRenderer
              title=""
              data={data}
              pluginId={suggestion.pluginId}
              width={renderWidth}
              height={renderHeight}
              options={preview.options}
              fieldConfig={preview.fieldConfig}
            />
            <div className={styles.hoverPane} />
          </div>
        </Tooltip>
      </button>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => {
  return {
    hoverPane: css({
      position: 'absolute',
      top: 0,
      right: 0,
      left: 0,
      borderRadius: theme.spacing(2),
      bottom: 0,
    }),
    vizBox: css`
      position: relative;
      background: none;
      border-radius: ${theme.shape.borderRadius(1)};
      cursor: pointer;
      border: 1px solid ${theme.colors.border.strong};

      transition: ${theme.transitions.create(['background'], {
        duration: theme.transitions.duration.short,
      })};

      &:hover {
        background: ${theme.colors.background.secondary};
      }
    `,
    name: css`
      font-size: ${theme.typography.bodySmall.fontSize};
      white-space: nowrap;
      overflow: hidden;
      color: ${theme.colors.text.secondary};
      font-weight: ${theme.typography.fontWeightMedium};
      text-overflow: ellipsis;
    `,
    renderContainer: css`
      position: absolute;
      transform-origin: left top;
      top: 6px;
      left: 6px;
    `,
  };
};

interface PreviewDimensionsAndStyles {
  renderWidth: number;
  renderHeight: number;
  innerStyles: CSSProperties;
  outerStyles: CSSProperties;
}

function getPreviewDimensionsAndStyles(width: number): PreviewDimensionsAndStyles {
  const aspectRatio = 16 / 10;
  const showWidth = width;
  const showHeight = width * (1 / aspectRatio);
  const renderWidth = 350;
  const renderHeight = renderWidth * (1 / aspectRatio);

  const padding = 6;
  const widthFactor = (showWidth - padding * 2) / renderWidth;
  const heightFactor = (showHeight - padding * 2) / renderHeight;

  return {
    renderHeight,
    renderWidth,
    outerStyles: { width: showWidth, height: showHeight },
    innerStyles: {
      width: renderWidth,
      height: renderHeight,
      transform: `scale(${widthFactor}, ${heightFactor})`,
    },
  };
}
