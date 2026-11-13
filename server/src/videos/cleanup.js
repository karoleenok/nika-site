// Уборка раз в сутки: незавершённые загрузки старше суток отменяются.
// Брошенные части занимают место в хранилище и стоят денег, хотя файла из них уже не будет.
import { ListMultipartUploadsCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3';

export const STALE_MS = 24 * 3600e3;

export async function cleanupUploads(pool, s3, { now = Date.now(), staleMs = STALE_MS } = {}) {
  const cutoff = new Date(now - staleMs);
  let aborted = 0;

  // 1. По данным хранилища: ловит и то, о чём база не знает (сбой между созданием загрузки и записью в базу).
  // Настоящий S3 сообщает дату начала (Initiated). Локальный SeaweedFS её не отдаёт:
  // тогда отменяем только «сирот», которых нет среди активных загрузок в базе.
  const known = new Set((await pool.query(`SELECT s3_upload_id FROM uploads WHERE status = 'active' AND created_at >= $1`, [cutoff])).rows.map((r) => r.s3_upload_id));
  let KeyMarker, UploadIdMarker;
  for (let page = 0; page < 50; page++) {
    const r = await s3.internal.send(new ListMultipartUploadsCommand({ Bucket: s3.bucket, Prefix: 'video/', KeyMarker, UploadIdMarker }));
    for (const u of r.Uploads || []) {
      const stale = u.Initiated ? new Date(u.Initiated) < cutoff : !known.has(u.UploadId);
      if (stale) {
        try { await s3.internal.send(new AbortMultipartUploadCommand({ Bucket: s3.bucket, Key: u.Key, UploadId: u.UploadId })); aborted++; } catch { /* уже нет */ }
      }
    }
    if (!r.IsTruncated) break;
    KeyMarker = r.NextKeyMarker; UploadIdMarker = r.NextUploadIdMarker;
  }

  // 2. В базе: старые активные загрузки помечаем отменёнными
  const { rows } = await pool.query(
    `UPDATE uploads SET status = 'aborted', finished_at = now() WHERE status = 'active' AND created_at < $1 RETURNING video_id, s3_key, s3_upload_id`, [cutoff]);
  for (const u of rows) {
    try { await s3.internal.send(new AbortMultipartUploadCommand({ Bucket: s3.bucket, Key: u.s3_key, UploadId: u.s3_upload_id })); } catch { /* уже нет */ }
  }
  if (rows.length) {
    await pool.query(`UPDATE videos SET status = CASE WHEN s3_key IS NULL THEN 'empty' ELSE 'ready' END
                       WHERE id = ANY($1::bigint[]) AND status <> 'ready'`, [rows.map((r) => r.video_id)]);
  }
  return { aborted, rows: rows.length };
}
