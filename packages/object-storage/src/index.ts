import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  GetBucketEncryptionCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketVersioningCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const bucket = process.env.S3_BUCKET ?? "rizpoint-private";
const endpoint = process.env.S3_ENDPOINT ?? "http://127.0.0.1:9000";
const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT ?? endpoint;
const accessKeyId =
  process.env.S3_ACCESS_KEY ?? "replace-with-local-access-key";
const secretAccessKey =
  process.env.S3_SECRET_KEY ?? "replace-with-local-secret-key";

const client = new S3Client({
  endpoint,
  forcePathStyle: true,
  region: process.env.S3_REGION ?? "us-east-1",
  credentials: { accessKeyId, secretAccessKey },
});

const publicClient = new S3Client({
  endpoint: publicEndpoint,
  forcePathStyle: true,
  region: process.env.S3_REGION ?? "us-east-1",
  credentials: { accessKeyId, secretAccessKey },
});

export async function createUploadUrl(
  objectKey: string,
  contentType: string,
): Promise<string> {
  return getSignedUrl(
    publicClient,
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: contentType,
    }),
    { expiresIn: 300 },
  );
}

export async function getObjectMetadata(objectKey: string) {
  return client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
}

export async function storageReady(): Promise<boolean> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    if (
      process.env.NODE_ENV === "production" &&
      process.env.RIZPOINT_PRIVATE_MODE === "true"
    ) {
      const [versioning, encryption, lifecycle] = await Promise.all([
        client.send(new GetBucketVersioningCommand({ Bucket: bucket })),
        client.send(new GetBucketEncryptionCommand({ Bucket: bucket })),
        client.send(
          new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }),
        ),
      ]);
      if (
        versioning.Status !== "Enabled" ||
        !encryption.ServerSideEncryptionConfiguration ||
        !lifecycle.Rules?.length
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function deletePrivateObject(objectKey: string): Promise<void> {
  await client.send(
    new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }),
  );
}

export async function getObjectBytes(objectKey: string): Promise<Uint8Array> {
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
  );
  if (!response.Body) throw new Error("Object body was empty.");
  return response.Body.transformToByteArray();
}

export async function putPrivateObject(input: {
  objectKey: string;
  body: Uint8Array;
  contentType: string;
  contentDisposition: string;
}): Promise<void> {
  const encryption = serverSideEncryption();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: input.objectKey,
      Body: input.body,
      ContentType: input.contentType,
      ContentDisposition: input.contentDisposition,
      ...encryption,
    }),
  );
}

function serverSideEncryption():
  | { ServerSideEncryption: "AES256" | "aws:kms"; SSEKMSKeyId?: string }
  | Record<string, never> {
  const mode = process.env.S3_SERVER_SIDE_ENCRYPTION;
  if (mode !== "AES256" && mode !== "aws:kms") return {};
  return {
    ServerSideEncryption: mode,
    ...(mode === "aws:kms" && process.env.S3_KMS_KEY_ID
      ? { SSEKMSKeyId: process.env.S3_KMS_KEY_ID }
      : {}),
  };
}

export async function createDownloadUrl(
  objectKey: string,
  filename: string,
): Promise<string> {
  return getSignedUrl(
    publicClient,
    new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ResponseContentDisposition: `attachment; filename="${filename.replaceAll(/[^A-Za-z0-9._-]/g, "_")}"`,
    }),
    { expiresIn: 300 },
  );
}
