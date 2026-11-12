import { S3Client } from '@aws-sdk/client-s3';

// Два клиента: внутренний (сервер → хранилище) и публичный (для подписанных ссылок,
// которые открывает браузер). На бою адрес один и тот же.
export function createS3(cfg) {
  const base = {
    region: cfg.region,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  };
  return {
    bucket: cfg.bucket,
    internal: new S3Client({ ...base, endpoint: cfg.endpoint }),
    signer: new S3Client({ ...base, endpoint: cfg.publicEndpoint }),
  };
}
