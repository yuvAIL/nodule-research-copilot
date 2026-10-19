import { describeOrientation } from '../dicom/seriesBuilder';
import { describeTransferSyntax, formatDicomDate } from '../dicom/headerMapping';
import type { CtSeries, DicomHeader } from '../dicom/types';

interface Props {
  series: CtSeries;
  current: DicomHeader | undefined;
}

type Row = [label: string, value: string | number | undefined];

function fmt(value: number | undefined, unit = '', digits = 2): string | undefined {
  return value === undefined ? undefined : `${Number(value.toFixed(digits))}${unit}`;
}

function shortUid(uid: string): string {
  return uid.length > 24 ? `…${uid.slice(-20)}` : uid;
}

function Table({ rows }: { rows: Row[] }) {
  return (
    <dl className="meta">
      {rows
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([label, value]) => (
          <div key={label} className="meta-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </dl>
  );
}

/**
 * Scan metadata. Patient-identifying attributes (name, ID, birth date) are
 * intentionally not shown or stored.
 */
export function MetadataPanel({ series, current }: Props) {
  const first = series.instances[0];
  if (!first) return null;
  const ps = first.pixelSpacing;

  const scanRows: Row[] = [
    ['Modality', first.modality],
    ['Study date', formatDicomDate(first.studyDate)],
    ['Study', first.studyDescription],
    ['Series', [first.seriesNumber !== undefined ? `#${first.seriesNumber}` : '', first.seriesDescription].filter(Boolean).join(' ')],
    ['Scanner', [first.manufacturer, first.manufacturerModelName].filter(Boolean).join(' ')],
    ['kVp', first.kvp],
    ['Kernel', first.convolutionKernel],
    ['Contrast', first.contrastBolusAgent ?? 'not recorded'],
    ['Image type', first.imageType?.replace(/\\/g, ' / ')],
  ];

  const geometryRows: Row[] = [
    ['Slices', series.instances.length],
    ['Matrix', first.rows && first.columns ? `${first.columns} × ${first.rows}` : undefined],
    ['Pixel spacing', ps ? `${fmt(ps[1], '', 3)} × ${fmt(ps[0], '', 3)} mm` : undefined],
    ['Slice thickness', fmt(first.sliceThickness, ' mm')],
    ['Slice spacing', fmt(series.sliceSpacingMm, ' mm')],
    ['Orientation', describeOrientation(first.imageOrientationPatient)],
    ['Slice order', { 'image-position': 'by position (superior → inferior)', 'instance-number': 'by InstanceNumber', 'file-order': 'by file name' }[series.sortMethod]],
    ['Encoding', describeTransferSyntax(first.transferSyntaxUid)],
    ['Series UID', shortUid(series.seriesInstanceUid)],
  ];

  const ipp = current?.imagePositionPatient;
  const sliceRows: Row[] = [
    ['Instance #', current?.instanceNumber],
    ['Slice location', fmt(current?.sliceLocation, ' mm')],
    ['Position (LPS)', ipp ? ipp.map((v) => v.toFixed(1)).join(', ') + ' mm' : undefined],
    ['File', current?.relativePath],
  ];

  return (
    <>
      <section className="panel">
        <h2>Scan</h2>
        <Table rows={scanRows} />
      </section>
      <section className="panel">
        <h2>Geometry</h2>
        <Table rows={geometryRows} />
      </section>
      <section className="panel">
        <h2>Current slice</h2>
        <Table rows={sliceRows} />
      </section>
    </>
  );
}
