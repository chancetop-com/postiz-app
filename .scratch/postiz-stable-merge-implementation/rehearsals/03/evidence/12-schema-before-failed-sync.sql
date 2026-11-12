--
-- PostgreSQL database dump
--


-- Dumped from database version 15.19 (Debian 15.19-1.pgdg13+2)
-- Dumped by pg_dump version 15.19 (Debian 15.19-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: APPROVED_SUBMIT_FOR_ORDER; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."APPROVED_SUBMIT_FOR_ORDER" AS ENUM (
    'NO',
    'WAITING_CONFIRMATION',
    'YES'
);


--
-- Name: AnnouncementColor; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AnnouncementColor" AS ENUM (
    'INFO',
    'WARNING',
    'ERROR'
);


--
-- Name: CreationMethod; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."CreationMethod" AS ENUM (
    'UNKNOWN',
    'WEB',
    'MCP',
    'API',
    'AUTOPOST',
    'CLI'
);


--
-- Name: From; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."From" AS ENUM (
    'BUYER',
    'SELLER'
);


--
-- Name: OrderStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."OrderStatus" AS ENUM (
    'PENDING',
    'ACCEPTED',
    'CANCELED',
    'COMPLETED'
);


--
-- Name: Period; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."Period" AS ENUM (
    'MONTHLY',
    'YEARLY'
);


--
-- Name: Provider; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."Provider" AS ENUM (
    'LOCAL',
    'GITHUB',
    'GOOGLE',
    'FARCASTER',
    'WALLET',
    'GENERIC',
    'APPLE'
);


--
-- Name: Role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."Role" AS ENUM (
    'SUPERADMIN',
    'ADMIN',
    'USER'
);


--
-- Name: ShortLinkPreference; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ShortLinkPreference" AS ENUM (
    'ASK',
    'YES',
    'NO'
);


--
-- Name: State; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."State" AS ENUM (
    'QUEUE',
    'PUBLISHED',
    'ERROR',
    'DRAFT'
);


--
-- Name: SubscriptionTier; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SubscriptionTier" AS ENUM (
    'STANDARD',
    'PRO',
    'TEAM',
    'ULTIMATE'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: Announcement; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Announcement" (
    id text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    color public."AnnouncementColor" DEFAULT 'INFO'::public."AnnouncementColor" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: AutoPost; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AutoPost" (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    title text NOT NULL,
    content text,
    "onSlot" boolean NOT NULL,
    "syncLast" boolean NOT NULL,
    url text NOT NULL,
    "lastUrl" text NOT NULL,
    active boolean NOT NULL,
    "addPicture" boolean NOT NULL,
    "generateContent" boolean NOT NULL,
    integrations text NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Clipping; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Clipping" (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    url text NOT NULL,
    status text DEFAULT 'analysing'::text NOT NULL,
    error text,
    title text,
    thumbnail text,
    duration integer,
    "maxClips" integer DEFAULT 5 NOT NULL,
    fit text DEFAULT 'blur'::text NOT NULL,
    integrations text NOT NULL,
    "creditsId" text,
    "deletedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ClippingClip; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ClippingClip" (
    id text NOT NULL,
    "clippingId" text NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    start double precision NOT NULL,
    "end" double precision NOT NULL,
    "trimStart" integer,
    status text DEFAULT 'pending'::text NOT NULL,
    error text,
    "mediaId" text,
    path text,
    thumbnail text,
    "draftedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Comments" (
    id text NOT NULL,
    content text NOT NULL,
    "organizationId" text NOT NULL,
    "postId" text NOT NULL,
    "userId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "anchorEnd" integer,
    "anchorQuote" text,
    "anchorStart" integer,
    "displayName" text,
    "parentId" text,
    "resolvedAt" timestamp(3) without time zone
);


--
-- Name: Credits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Credits" (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    credits integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    type text DEFAULT 'ai_images'::text NOT NULL
);


--
-- Name: Customer; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Customer" (
    id text NOT NULL,
    name text NOT NULL,
    "orgId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone
);


--
-- Name: Errors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Errors" (
    id text NOT NULL,
    message text NOT NULL,
    platform text NOT NULL,
    "organizationId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "postId" text NOT NULL,
    body text DEFAULT '{}'::text NOT NULL
);


--
-- Name: ExisingPlugData; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ExisingPlugData" (
    id text NOT NULL,
    "integrationId" text NOT NULL,
    "methodName" text NOT NULL,
    value text NOT NULL
);


--
-- Name: GitHub; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."GitHub" (
    id text NOT NULL,
    login text,
    name text,
    token text NOT NULL,
    "jobId" text,
    "organizationId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Integration; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Integration" (
    id text NOT NULL,
    "internalId" text NOT NULL,
    "organizationId" text NOT NULL,
    name text NOT NULL,
    picture text,
    "providerIdentifier" text NOT NULL,
    type text NOT NULL,
    token text NOT NULL,
    disabled boolean DEFAULT false NOT NULL,
    "tokenExpiration" timestamp(3) without time zone,
    "refreshToken" text,
    profile text,
    "deletedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone,
    "inBetweenSteps" boolean DEFAULT false NOT NULL,
    "refreshNeeded" boolean DEFAULT false NOT NULL,
    "postingTimes" text DEFAULT '[{"time":120}, {"time":400}, {"time":700}]'::text NOT NULL,
    "customInstanceDetails" text,
    "customerId" text,
    "rootInternalId" text,
    "additionalSettings" text DEFAULT '[]'::text,
    "customName" text
);


--
-- Name: IntegrationsWebhooks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."IntegrationsWebhooks" (
    "integrationId" text NOT NULL,
    "webhookId" text NOT NULL
);


--
-- Name: ItemUser; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ItemUser" (
    id text NOT NULL,
    "userId" text NOT NULL,
    key text NOT NULL
);


--
-- Name: Media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Media" (
    id text NOT NULL,
    name text NOT NULL,
    "originalName" text,
    path text NOT NULL,
    "organizationId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "fileSize" integer DEFAULT 0 NOT NULL,
    type text DEFAULT 'image'::text NOT NULL,
    thumbnail text,
    alt text,
    "thumbnailTimestamp" integer,
    "processingError" text,
    status text DEFAULT 'ready'::text NOT NULL
);


--
-- Name: Mentions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Mentions" (
    name text NOT NULL,
    username text NOT NULL,
    platform text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    image text NOT NULL
);


--
-- Name: Messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Messages" (
    id text NOT NULL,
    "from" public."From" NOT NULL,
    content text,
    "groupId" text NOT NULL,
    special text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone
);


--
-- Name: MessagesGroup; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."MessagesGroup" (
    id text NOT NULL,
    "buyerOrganizationId" text NOT NULL,
    "buyerId" text NOT NULL,
    "sellerId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Notifications" (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    content text NOT NULL,
    link text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone
);


--
-- Name: OAuthApp; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."OAuthApp" (
    id text NOT NULL,
    "organizationId" text,
    name text NOT NULL,
    description text,
    "pictureId" text,
    "redirectUrl" text NOT NULL,
    "clientId" text NOT NULL,
    "clientSecret" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    dynamic boolean DEFAULT false NOT NULL,
    "redirectUris" text,
    "tokenEndpointAuthMethod" text
);


--
-- Name: OAuthAuthorization; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."OAuthAuthorization" (
    id text NOT NULL,
    "oauthAppId" text NOT NULL,
    "userId" text NOT NULL,
    "organizationId" text NOT NULL,
    "accessToken" text,
    "authorizationCode" text,
    "codeExpiresAt" timestamp(3) without time zone,
    "revokedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "codeChallenge" text,
    "codeChallengeMethod" text,
    "redirectUri" text
);


--
-- Name: OAuthSelfHostedAuthorization; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."OAuthSelfHostedAuthorization" (
    id text NOT NULL,
    "oauthAppId" text NOT NULL,
    "mcpUrl" text NOT NULL,
    "apiKey" text NOT NULL,
    email text,
    "accessToken" text,
    "authorizationCode" text,
    "codeExpiresAt" timestamp(3) without time zone,
    "codeChallenge" text,
    "codeChallengeMethod" text,
    "redirectUri" text,
    "revokedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: OrderItems; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."OrderItems" (
    id text NOT NULL,
    "orderId" text NOT NULL,
    "integrationId" text NOT NULL,
    quantity integer NOT NULL,
    price integer NOT NULL
);


--
-- Name: Orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Orders" (
    id text NOT NULL,
    "buyerId" text NOT NULL,
    "sellerId" text NOT NULL,
    status public."OrderStatus" NOT NULL,
    "messageGroupId" text NOT NULL,
    "captureId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Organization; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Organization" (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    "apiKey" text,
    "paymentId" text,
    "streakSince" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "allowTrial" boolean DEFAULT false NOT NULL,
    "isTrailing" boolean DEFAULT false NOT NULL,
    shortlink public."ShortLinkPreference" DEFAULT 'ASK'::public."ShortLinkPreference" NOT NULL,
    "deletedAt" timestamp(3) without time zone
);


--
-- Name: PayoutProblems; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PayoutProblems" (
    id text NOT NULL,
    status text NOT NULL,
    "orderId" text NOT NULL,
    "userId" text NOT NULL,
    "postId" text,
    amount integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Plugs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Plugs" (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "plugFunction" text NOT NULL,
    data text NOT NULL,
    "integrationId" text NOT NULL,
    activated boolean DEFAULT true NOT NULL
);


--
-- Name: PopularPosts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PopularPosts" (
    id text NOT NULL,
    category text NOT NULL,
    topic text NOT NULL,
    content text NOT NULL,
    hook text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Post; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Post" (
    id text NOT NULL,
    state public."State" DEFAULT 'QUEUE'::public."State" NOT NULL,
    "publishDate" timestamp(3) without time zone NOT NULL,
    "organizationId" text NOT NULL,
    "integrationId" text NOT NULL,
    content text NOT NULL,
    delay integer DEFAULT 0 NOT NULL,
    "group" text NOT NULL,
    title text,
    description text,
    "parentPostId" text,
    "releaseId" text,
    "releaseURL" text,
    settings text,
    image text,
    "submittedForOrderId" text,
    "submittedForOrganizationId" text,
    "approvedSubmitForOrder" public."APPROVED_SUBMIT_FOR_ORDER" DEFAULT 'NO'::public."APPROVED_SUBMIT_FOR_ORDER" NOT NULL,
    "lastMessageId" text,
    "intervalInDays" integer,
    error text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "batchId" text,
    "creationMethod" public."CreationMethod" DEFAULT 'UNKNOWN'::public."CreationMethod" NOT NULL
);


--
-- Name: Sets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Sets" (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    name text NOT NULL,
    content text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Signatures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Signatures" (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    content text NOT NULL,
    "autoAdd" boolean NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone
);


--
-- Name: SocialMediaAgency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SocialMediaAgency" (
    id text NOT NULL,
    "userId" text NOT NULL,
    name text NOT NULL,
    "logoId" text,
    website text,
    slug text,
    facebook text,
    instagram text,
    twitter text,
    "linkedIn" text,
    youtube text,
    tiktok text,
    "otherSocialMedia" text,
    "shortDescription" text NOT NULL,
    description text NOT NULL,
    approved boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone
);


--
-- Name: SocialMediaAgencyNiche; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SocialMediaAgencyNiche" (
    "agencyId" text NOT NULL,
    niche text NOT NULL
);


--
-- Name: Star; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Star" (
    id text NOT NULL,
    stars integer NOT NULL,
    "totalStars" integer NOT NULL,
    forks integer NOT NULL,
    "totalForks" integer NOT NULL,
    login text NOT NULL,
    date date DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Subscription; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Subscription" (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "subscriptionTier" public."SubscriptionTier" NOT NULL,
    identifier text,
    "cancelAt" timestamp(3) without time zone,
    period public."Period" NOT NULL,
    "totalChannels" integer NOT NULL,
    "isLifetime" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    provider text DEFAULT 'stripe'::text NOT NULL
);


--
-- Name: Tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Tags" (
    id text NOT NULL,
    name text NOT NULL,
    color text NOT NULL,
    "orgId" text NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: TagsPosts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TagsPosts" (
    "postId" text NOT NULL,
    "tagId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ThirdParty; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ThirdParty" (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    identifier text NOT NULL,
    name text NOT NULL,
    "internalId" text NOT NULL,
    "apiKey" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone
);


--
-- Name: Trending; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Trending" (
    id text NOT NULL,
    "trendingList" text NOT NULL,
    language text,
    hash text NOT NULL,
    date timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: TrendingLog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TrendingLog" (
    id text NOT NULL,
    language text,
    date timestamp(3) without time zone NOT NULL
);


--
-- Name: UsedCodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."UsedCodes" (
    id text NOT NULL,
    code text NOT NULL,
    "orgId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: User; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."User" (
    id text NOT NULL,
    email text NOT NULL,
    password text,
    "providerName" public."Provider" NOT NULL,
    name text,
    "lastName" text,
    "isSuperAdmin" boolean DEFAULT false NOT NULL,
    bio text,
    audience integer DEFAULT 0 NOT NULL,
    "pictureId" text,
    "providerId" text,
    timezone integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "lastReadNotifications" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "inviteId" text,
    activated boolean DEFAULT true NOT NULL,
    account text,
    "connectedAccount" boolean DEFAULT false NOT NULL,
    "lastOnline" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    ip text,
    agent text,
    "sendSuccessEmails" boolean DEFAULT true NOT NULL,
    "sendFailureEmails" boolean DEFAULT true NOT NULL,
    "sendStreakEmails" boolean DEFAULT true NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "timezoneName" text
);


--
-- Name: UserOrganization; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."UserOrganization" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "organizationId" text NOT NULL,
    disabled boolean DEFAULT false NOT NULL,
    role public."Role" DEFAULT 'USER'::public."Role" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Webhooks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Webhooks" (
    id text NOT NULL,
    name text NOT NULL,
    "organizationId" text NOT NULL,
    url text NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: legacy_unmanaged_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legacy_unmanaged_archive (
    id integer NOT NULL,
    note text NOT NULL
);


--
-- Name: legacy_unmanaged_archive_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.legacy_unmanaged_archive_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: legacy_unmanaged_archive_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.legacy_unmanaged_archive_id_seq OWNED BY public.legacy_unmanaged_archive.id;


--
-- Name: mastra_agent_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_agent_versions (
    id text NOT NULL,
    "agentId" text NOT NULL,
    "versionNumber" integer NOT NULL,
    name text NOT NULL,
    description text,
    instructions text NOT NULL,
    model jsonb NOT NULL,
    tools jsonb,
    "defaultOptions" jsonb,
    workflows jsonb,
    agents jsonb,
    "integrationTools" jsonb,
    "inputProcessors" jsonb,
    "outputProcessors" jsonb,
    memory jsonb,
    scorers jsonb,
    "mcpClients" jsonb,
    "requestContextSchema" jsonb,
    workspace jsonb,
    skills jsonb,
    "skillsFormat" text,
    "changedFields" jsonb,
    "changeMessage" text,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    durable jsonb,
    browser jsonb,
    "toolProviders" jsonb
);


--
-- Name: mastra_agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_agents (
    id text NOT NULL,
    status text NOT NULL,
    "activeVersionId" text,
    "authorId" text,
    metadata jsonb,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "updatedAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    visibility text,
    "favoriteCount" integer
);


--
-- Name: mastra_ai_spans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_ai_spans (
    "traceId" text NOT NULL,
    "spanId" text NOT NULL,
    "parentSpanId" text,
    name text NOT NULL,
    scope jsonb,
    "spanType" text NOT NULL,
    attributes jsonb,
    metadata jsonb,
    links jsonb,
    input jsonb,
    output jsonb,
    error jsonb,
    "startedAt" timestamp(6) without time zone NOT NULL,
    "endedAt" timestamp(6) without time zone,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "updatedAt" timestamp(6) without time zone,
    "isEvent" boolean NOT NULL,
    "startedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "endedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "entityId" text,
    "entityName" text,
    "entityType" text,
    "entityVersionId" text,
    environment text,
    "experimentId" text,
    "organizationId" text,
    "parentEntityId" text,
    "parentEntityName" text,
    "parentEntityType" text,
    "parentEntityVersionId" text,
    "requestContext" jsonb,
    "requestId" text,
    "resourceId" text,
    "rootEntityId" text,
    "rootEntityName" text,
    "rootEntityType" text,
    "rootEntityVersionId" text,
    "runId" text,
    "serviceName" text,
    "sessionId" text,
    source text,
    tags jsonb,
    "threadId" text,
    "userId" text
);


--
-- Name: mastra_background_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_background_tasks (
    id text NOT NULL,
    tool_call_id text NOT NULL,
    tool_name text NOT NULL,
    agent_id text NOT NULL,
    run_id text NOT NULL,
    thread_id text,
    resource_id text,
    status text NOT NULL,
    args jsonb NOT NULL,
    result jsonb,
    error jsonb,
    suspend_payload jsonb,
    retry_count integer NOT NULL,
    max_retries integer NOT NULL,
    timeout_ms integer NOT NULL,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "startedAt" timestamp(6) without time zone,
    "suspendedAt" timestamp(6) without time zone,
    "completedAt" timestamp(6) without time zone,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "startedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "suspendedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "completedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_channel_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_channel_config (
    platform text NOT NULL,
    data jsonb NOT NULL,
    "updatedAt" timestamp(6) without time zone NOT NULL,
    "updatedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_channel_installations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_channel_installations (
    id text NOT NULL,
    platform text NOT NULL,
    "agentId" text NOT NULL,
    status text NOT NULL,
    "webhookId" text,
    data jsonb NOT NULL,
    "configHash" text,
    error text,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "updatedAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_dataset_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_dataset_items (
    id text NOT NULL,
    "datasetId" text NOT NULL,
    "datasetVersion" integer NOT NULL,
    "validTo" integer,
    "isDeleted" boolean NOT NULL,
    input jsonb NOT NULL,
    "groundTruth" jsonb,
    "requestContext" jsonb,
    metadata jsonb,
    source jsonb,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "updatedAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "expectedTrajectory" jsonb,
    "organizationId" text,
    "projectId" text,
    "toolMocks" jsonb,
    "unmockedToolPolicy" text,
    "scorerIds" jsonb,
    "externalId" text
);


--
-- Name: mastra_dataset_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_dataset_versions (
    id text NOT NULL,
    "datasetId" text NOT NULL,
    version integer NOT NULL,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_datasets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_datasets (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    metadata jsonb,
    "inputSchema" jsonb,
    "groundTruthSchema" jsonb,
    "requestContextSchema" jsonb,
    tags jsonb,
    "targetType" text,
    "targetIds" jsonb,
    "scorerIds" jsonb,
    version integer NOT NULL,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "updatedAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "organizationId" text,
    "projectId" text,
    "candidateKey" text,
    "candidateId" text
);


--
-- Name: mastra_evals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_evals (
    input text NOT NULL,
    output text NOT NULL,
    result jsonb NOT NULL,
    agent_name text NOT NULL,
    metric_name text NOT NULL,
    instructions text NOT NULL,
    test_info jsonb,
    global_run_id text NOT NULL,
    run_id text NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    "createdAt" timestamp(6) without time zone,
    "created_atZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_experiment_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_experiment_results (
    id text NOT NULL,
    "experimentId" text NOT NULL,
    "itemId" text NOT NULL,
    "itemDatasetVersion" integer,
    input jsonb NOT NULL,
    output jsonb,
    "groundTruth" jsonb,
    error jsonb,
    "startedAt" timestamp(6) without time zone NOT NULL,
    "completedAt" timestamp(6) without time zone NOT NULL,
    "retryCount" integer NOT NULL,
    "traceId" text,
    status text,
    tags jsonb,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "startedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "completedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    comment text,
    "toolMockReport" jsonb,
    metadata jsonb,
    "organizationId" text,
    "projectId" text,
    attempt integer
);


--
-- Name: mastra_experiments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_experiments (
    id text NOT NULL,
    name text,
    description text,
    metadata jsonb,
    "datasetId" text,
    "datasetVersion" integer,
    "targetType" text NOT NULL,
    "targetId" text NOT NULL,
    status text NOT NULL,
    "totalItems" integer NOT NULL,
    "succeededCount" integer NOT NULL,
    "failedCount" integer NOT NULL,
    "skippedCount" integer NOT NULL,
    "startedAt" timestamp(6) without time zone,
    "completedAt" timestamp(6) without time zone,
    "agentVersion" text,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "updatedAt" timestamp(6) without time zone NOT NULL,
    "startedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "completedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "organizationId" text,
    "projectId" text,
    provenance jsonb,
    "runnerAttestation" jsonb,
    "experimentSetId" text,
    "comparisonId" text,
    "variantId" text,
    "trialIndex" integer,
    "scorerIds" jsonb
);


--
-- Name: mastra_favorites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_favorites (
    "userId" text NOT NULL,
    "entityType" text NOT NULL,
    "entityId" text NOT NULL,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_knowledge_activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_knowledge_activity (
    id text NOT NULL,
    action text NOT NULL,
    "recordType" text NOT NULL,
    "recordId" text NOT NULL,
    scope jsonb NOT NULL,
    "scopeKey" text NOT NULL,
    "sourceThreadId" text,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_knowledge_cursors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_knowledge_cursors (
    "sourceThreadId" text NOT NULL,
    agent text NOT NULL,
    "lastKnowledgeId" text NOT NULL,
    "updatedAt" timestamp(6) without time zone NOT NULL,
    "updatedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_knowledge_mentions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_knowledge_mentions (
    "sourceType" text NOT NULL,
    "sourceId" text NOT NULL,
    "recordId" text NOT NULL
);


--
-- Name: mastra_knowledge_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_knowledge_nodes (
    id text NOT NULL,
    type text NOT NULL,
    name text NOT NULL,
    "canonicalName" text NOT NULL,
    kind text,
    content text,
    description text,
    scope jsonb NOT NULL,
    "scopeKey" text NOT NULL,
    version integer NOT NULL,
    "mergedInto" text,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "updatedAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_knowledge_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_knowledge_records (
    id text NOT NULL,
    node text NOT NULL,
    text text NOT NULL,
    scope jsonb NOT NULL,
    "scopeKey" text NOT NULL,
    "sourceThreadId" text NOT NULL,
    "capturedAt" timestamp(6) without time zone NOT NULL,
    "when" timestamp(6) without time zone,
    "maxScope" text,
    metadata jsonb,
    "deletedAt" timestamp(6) without time zone,
    "deletedBy" text,
    "capturedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "whenZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "deletedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_knowledge_semantic_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_knowledge_semantic_outbox (
    id text NOT NULL,
    "idempotencyKey" text NOT NULL,
    "documentId" text NOT NULL,
    "documentType" text NOT NULL,
    operation text NOT NULL,
    scope jsonb NOT NULL,
    "scopeKey" text NOT NULL,
    status text NOT NULL,
    attempts integer NOT NULL,
    "availableAt" timestamp(6) without time zone NOT NULL,
    "claimedAt" timestamp(6) without time zone,
    "claimedBy" text,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "completedAt" timestamp(6) without time zone,
    "availableAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "claimedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "completedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_mcp_client_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_mcp_client_versions (
    id text NOT NULL,
    "mcpClientId" text NOT NULL,
    "versionNumber" integer NOT NULL,
    name text NOT NULL,
    description text,
    servers jsonb NOT NULL,
    "changedFields" jsonb,
    "changeMessage" text,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_mcp_clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_mcp_clients (
    id text NOT NULL,
    status text NOT NULL,
    "activeVersionId" text,
    "authorId" text,
    metadata jsonb,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "updatedAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_mcp_server_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_mcp_server_versions (
    id text NOT NULL,
    "mcpServerId" text NOT NULL,
    "versionNumber" integer NOT NULL,
    name text NOT NULL,
    version text NOT NULL,
    description text,
    instructions text,
    repository jsonb,
    "releaseDate" text,
    "isLatest" boolean,
    "packageCanonical" text,
    tools jsonb,
    agents jsonb,
    workflows jsonb,
    "changedFields" jsonb,
    "changeMessage" text,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_mcp_servers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_mcp_servers (
    id text NOT NULL,
    status text NOT NULL,
    "activeVersionId" text,
    "authorId" text,
    metadata jsonb,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "updatedAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_messages (
    id text NOT NULL,
    thread_id text NOT NULL,
    content text NOT NULL,
    role text NOT NULL,
    type text NOT NULL,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "resourceId" text,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_notifications (
    id text NOT NULL,
    "threadId" text NOT NULL,
    source text NOT NULL,
    kind text NOT NULL,
    priority text NOT NULL,
    status text NOT NULL,
    summary text NOT NULL,
    payload jsonb,
    "resourceId" text,
    "agentId" text,
    "sourceId" text,
    "dedupeKey" text,
    "coalesceKey" text,
    "coalescedCount" integer NOT NULL,
    attributes jsonb,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "updatedAt" timestamp(6) without time zone NOT NULL,
    "deliveredAt" timestamp(6) without time zone,
    "seenAt" timestamp(6) without time zone,
    "dismissedAt" timestamp(6) without time zone,
    "archivedAt" timestamp(6) without time zone,
    "discardedAt" timestamp(6) without time zone,
    "deliverAt" timestamp(6) without time zone,
    "summaryAt" timestamp(6) without time zone,
    "deliveryReason" text,
    "deliveryAttempts" integer NOT NULL,
    "lastDeliveryAttemptAt" timestamp(6) without time zone,
    "lastDeliveryError" text,
    "deliveredSignalId" text,
    "summarySignalId" text,
    metadata jsonb,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "deliveredAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "seenAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "dismissedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "archivedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "discardedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "deliverAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "summaryAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "lastDeliveryAttemptAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_observational_memory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_observational_memory (
    id text NOT NULL,
    "lookupKey" text NOT NULL,
    scope text NOT NULL,
    "resourceId" text,
    "threadId" text,
    "activeObservations" text NOT NULL,
    "activeObservationsPendingUpdate" text,
    "originType" text NOT NULL,
    config text NOT NULL,
    "generationCount" integer NOT NULL,
    "lastObservedAt" timestamp(6) without time zone,
    "lastReflectionAt" timestamp(6) without time zone,
    "pendingMessageTokens" integer NOT NULL,
    "totalTokensObserved" integer NOT NULL,
    "observationTokenCount" integer NOT NULL,
    "isObserving" boolean NOT NULL,
    "isReflecting" boolean NOT NULL,
    "observedMessageIds" jsonb,
    "observedTimezone" text,
    "bufferedObservations" text,
    "bufferedObservationTokens" integer,
    "bufferedMessageIds" jsonb,
    "bufferedReflection" text,
    "bufferedReflectionTokens" integer,
    "bufferedReflectionInputTokens" integer,
    "reflectedObservationLineCount" integer,
    "bufferedObservationChunks" jsonb,
    "isBufferingObservation" boolean NOT NULL,
    "isBufferingReflection" boolean NOT NULL,
    "lastBufferedAtTokens" integer NOT NULL,
    "lastBufferedAtTime" timestamp(6) without time zone,
    metadata jsonb,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "updatedAt" timestamp(6) without time zone NOT NULL,
    "lastObservedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "lastReflectionAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "lastBufferedAtTimeZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_prompt_block_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_prompt_block_versions (
    id text NOT NULL,
    "blockId" text NOT NULL,
    "versionNumber" integer NOT NULL,
    name text NOT NULL,
    description text,
    content text NOT NULL,
    rules jsonb,
    "requestContextSchema" jsonb,
    "changedFields" jsonb,
    "changeMessage" text,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_prompt_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_prompt_blocks (
    id text NOT NULL,
    status text NOT NULL,
    "activeVersionId" text,
    "authorId" text,
    metadata jsonb,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "updatedAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_resources (
    id text NOT NULL,
    "workingMemory" text,
    metadata jsonb,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "updatedAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_schedule_triggers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_schedule_triggers (
    id text NOT NULL,
    schedule_id text NOT NULL,
    run_id text,
    scheduled_fire_at bigint NOT NULL,
    actual_fire_at bigint NOT NULL,
    outcome text NOT NULL,
    error text,
    trigger_kind text NOT NULL,
    parent_trigger_id text,
    metadata jsonb
);


--
-- Name: mastra_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_schedules (
    id text NOT NULL,
    target jsonb NOT NULL,
    cron text NOT NULL,
    timezone text,
    status text NOT NULL,
    next_fire_at bigint NOT NULL,
    last_fire_at bigint,
    last_run_id text,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    metadata jsonb,
    owner_type text,
    owner_id text
);


--
-- Name: mastra_scorer_definition_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_scorer_definition_versions (
    id text NOT NULL,
    "scorerDefinitionId" text NOT NULL,
    "versionNumber" integer NOT NULL,
    name text NOT NULL,
    description text,
    type text NOT NULL,
    model jsonb,
    instructions text,
    "scoreRange" jsonb,
    "presetConfig" jsonb,
    "defaultSampling" jsonb,
    "changedFields" jsonb,
    "changeMessage" text,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_scorer_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_scorer_definitions (
    id text NOT NULL,
    status text NOT NULL,
    "activeVersionId" text,
    "authorId" text,
    metadata jsonb,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "updatedAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "organizationId" text,
    "projectId" text
);


--
-- Name: mastra_scorers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_scorers (
    id text NOT NULL,
    "scorerId" text NOT NULL,
    "traceId" text,
    "runId" text NOT NULL,
    scorer jsonb NOT NULL,
    "preprocessStepResult" jsonb,
    "extractStepResult" jsonb,
    "analyzeStepResult" jsonb,
    score double precision NOT NULL,
    reason text,
    metadata jsonb,
    "preprocessPrompt" text,
    "extractPrompt" text,
    "generateScorePrompt" text,
    "generateReasonPrompt" text,
    "analyzePrompt" text,
    "reasonPrompt" text,
    input jsonb NOT NULL,
    output jsonb NOT NULL,
    "additionalContext" jsonb,
    "runtimeContext" jsonb,
    "entityType" text,
    entity jsonb,
    "entityId" text,
    source text NOT NULL,
    "resourceId" text,
    "threadId" text,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "updatedAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "spanId" text,
    "batchId" text,
    "datasetId" text,
    "datasetItemId" text,
    "organizationId" text,
    "projectId" text,
    "requestContext" jsonb
);


--
-- Name: mastra_skill_blobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_skill_blobs (
    hash text NOT NULL,
    content text NOT NULL,
    size integer NOT NULL,
    "mimeType" text,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_skill_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_skill_versions (
    id text NOT NULL,
    "skillId" text NOT NULL,
    "versionNumber" integer NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    instructions text NOT NULL,
    license text,
    compatibility jsonb,
    source jsonb,
    "references" jsonb,
    scripts jsonb,
    assets jsonb,
    metadata jsonb,
    tree jsonb,
    "changedFields" jsonb,
    "changeMessage" text,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    files jsonb
);


--
-- Name: mastra_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_skills (
    id text NOT NULL,
    status text NOT NULL,
    "activeVersionId" text,
    "authorId" text,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "updatedAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    visibility text,
    "favoriteCount" integer
);


--
-- Name: mastra_thread_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_thread_state (
    "threadId" text NOT NULL,
    type text NOT NULL,
    value jsonb NOT NULL,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "updatedAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_threads (
    id text NOT NULL,
    "resourceId" text NOT NULL,
    title text NOT NULL,
    metadata text,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "updatedAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_tool_provider_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_tool_provider_connections (
    "authorId" text NOT NULL,
    "providerId" text NOT NULL,
    "connectionId" text NOT NULL,
    toolkit text NOT NULL,
    label text,
    scope text NOT NULL,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "updatedAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_traces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_traces (
    id text NOT NULL,
    "parentSpanId" text,
    name text NOT NULL,
    "traceId" text NOT NULL,
    scope text NOT NULL,
    kind integer NOT NULL,
    attributes jsonb,
    status jsonb,
    events jsonb,
    links jsonb,
    other text,
    "startTime" bigint NOT NULL,
    "endTime" bigint NOT NULL,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_workflow_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_workflow_definitions (
    id text NOT NULL,
    description text,
    metadata jsonb,
    "inputSchema" jsonb NOT NULL,
    "outputSchema" jsonb NOT NULL,
    "stateSchema" jsonb,
    "requestContextSchema" jsonb,
    graph jsonb NOT NULL,
    schedule jsonb,
    status text NOT NULL,
    source text NOT NULL,
    "authorId" text,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "updatedAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_workflow_snapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_workflow_snapshot (
    workflow_name text NOT NULL,
    run_id text NOT NULL,
    "resourceId" text,
    snapshot text NOT NULL,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "updatedAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_workspace_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_workspace_versions (
    id text NOT NULL,
    "workspaceId" text NOT NULL,
    "versionNumber" integer NOT NULL,
    name text NOT NULL,
    description text,
    filesystem jsonb,
    sandbox jsonb,
    mounts jsonb,
    search jsonb,
    skills jsonb,
    tools jsonb,
    "autoSync" boolean,
    "operationTimeout" integer,
    "changedFields" jsonb,
    "changeMessage" text,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: mastra_workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mastra_workspaces (
    id text NOT NULL,
    status text NOT NULL,
    "activeVersionId" text,
    "authorId" text,
    metadata jsonb,
    "createdAt" timestamp(6) without time zone NOT NULL,
    "updatedAt" timestamp(6) without time zone NOT NULL,
    "createdAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: legacy_unmanaged_archive id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legacy_unmanaged_archive ALTER COLUMN id SET DEFAULT nextval('public.legacy_unmanaged_archive_id_seq'::regclass);


--
-- Name: Announcement Announcement_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Announcement"
    ADD CONSTRAINT "Announcement_pkey" PRIMARY KEY (id);


--
-- Name: AutoPost AutoPost_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AutoPost"
    ADD CONSTRAINT "AutoPost_pkey" PRIMARY KEY (id);


--
-- Name: ClippingClip ClippingClip_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ClippingClip"
    ADD CONSTRAINT "ClippingClip_pkey" PRIMARY KEY (id);


--
-- Name: Clipping Clipping_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Clipping"
    ADD CONSTRAINT "Clipping_pkey" PRIMARY KEY (id);


--
-- Name: Comments Comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Comments"
    ADD CONSTRAINT "Comments_pkey" PRIMARY KEY (id);


--
-- Name: Credits Credits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Credits"
    ADD CONSTRAINT "Credits_pkey" PRIMARY KEY (id);


--
-- Name: Customer Customer_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Customer"
    ADD CONSTRAINT "Customer_pkey" PRIMARY KEY (id);


--
-- Name: Errors Errors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Errors"
    ADD CONSTRAINT "Errors_pkey" PRIMARY KEY (id);


--
-- Name: ExisingPlugData ExisingPlugData_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ExisingPlugData"
    ADD CONSTRAINT "ExisingPlugData_pkey" PRIMARY KEY (id);


--
-- Name: GitHub GitHub_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."GitHub"
    ADD CONSTRAINT "GitHub_pkey" PRIMARY KEY (id);


--
-- Name: Integration Integration_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Integration"
    ADD CONSTRAINT "Integration_pkey" PRIMARY KEY (id);


--
-- Name: IntegrationsWebhooks IntegrationsWebhooks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."IntegrationsWebhooks"
    ADD CONSTRAINT "IntegrationsWebhooks_pkey" PRIMARY KEY ("integrationId", "webhookId");


--
-- Name: ItemUser ItemUser_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ItemUser"
    ADD CONSTRAINT "ItemUser_pkey" PRIMARY KEY (id);


--
-- Name: Media Media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Media"
    ADD CONSTRAINT "Media_pkey" PRIMARY KEY (id);


--
-- Name: Mentions Mentions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Mentions"
    ADD CONSTRAINT "Mentions_pkey" PRIMARY KEY (name, username, platform, image);


--
-- Name: MessagesGroup MessagesGroup_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MessagesGroup"
    ADD CONSTRAINT "MessagesGroup_pkey" PRIMARY KEY (id);


--
-- Name: Messages Messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Messages"
    ADD CONSTRAINT "Messages_pkey" PRIMARY KEY (id);


--
-- Name: Notifications Notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Notifications"
    ADD CONSTRAINT "Notifications_pkey" PRIMARY KEY (id);


--
-- Name: OAuthApp OAuthApp_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OAuthApp"
    ADD CONSTRAINT "OAuthApp_pkey" PRIMARY KEY (id);


--
-- Name: OAuthAuthorization OAuthAuthorization_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OAuthAuthorization"
    ADD CONSTRAINT "OAuthAuthorization_pkey" PRIMARY KEY (id);


--
-- Name: OAuthSelfHostedAuthorization OAuthSelfHostedAuthorization_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OAuthSelfHostedAuthorization"
    ADD CONSTRAINT "OAuthSelfHostedAuthorization_pkey" PRIMARY KEY (id);


--
-- Name: OrderItems OrderItems_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OrderItems"
    ADD CONSTRAINT "OrderItems_pkey" PRIMARY KEY (id);


--
-- Name: Orders Orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Orders"
    ADD CONSTRAINT "Orders_pkey" PRIMARY KEY (id);


--
-- Name: Organization Organization_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Organization"
    ADD CONSTRAINT "Organization_pkey" PRIMARY KEY (id);


--
-- Name: PayoutProblems PayoutProblems_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PayoutProblems"
    ADD CONSTRAINT "PayoutProblems_pkey" PRIMARY KEY (id);


--
-- Name: Plugs Plugs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Plugs"
    ADD CONSTRAINT "Plugs_pkey" PRIMARY KEY (id);


--
-- Name: PopularPosts PopularPosts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PopularPosts"
    ADD CONSTRAINT "PopularPosts_pkey" PRIMARY KEY (id);


--
-- Name: Post Post_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Post"
    ADD CONSTRAINT "Post_pkey" PRIMARY KEY (id);


--
-- Name: Sets Sets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Sets"
    ADD CONSTRAINT "Sets_pkey" PRIMARY KEY (id);


--
-- Name: Signatures Signatures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Signatures"
    ADD CONSTRAINT "Signatures_pkey" PRIMARY KEY (id);


--
-- Name: SocialMediaAgencyNiche SocialMediaAgencyNiche_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SocialMediaAgencyNiche"
    ADD CONSTRAINT "SocialMediaAgencyNiche_pkey" PRIMARY KEY ("agencyId", niche);


--
-- Name: SocialMediaAgency SocialMediaAgency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SocialMediaAgency"
    ADD CONSTRAINT "SocialMediaAgency_pkey" PRIMARY KEY (id);


--
-- Name: Star Star_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Star"
    ADD CONSTRAINT "Star_pkey" PRIMARY KEY (id);


--
-- Name: Subscription Subscription_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Subscription"
    ADD CONSTRAINT "Subscription_pkey" PRIMARY KEY (id);


--
-- Name: TagsPosts TagsPosts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TagsPosts"
    ADD CONSTRAINT "TagsPosts_pkey" PRIMARY KEY ("postId", "tagId");


--
-- Name: Tags Tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Tags"
    ADD CONSTRAINT "Tags_pkey" PRIMARY KEY (id);


--
-- Name: ThirdParty ThirdParty_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ThirdParty"
    ADD CONSTRAINT "ThirdParty_pkey" PRIMARY KEY (id);


--
-- Name: TrendingLog TrendingLog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TrendingLog"
    ADD CONSTRAINT "TrendingLog_pkey" PRIMARY KEY (id);


--
-- Name: Trending Trending_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Trending"
    ADD CONSTRAINT "Trending_pkey" PRIMARY KEY (id);


--
-- Name: UsedCodes UsedCodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."UsedCodes"
    ADD CONSTRAINT "UsedCodes_pkey" PRIMARY KEY (id);


--
-- Name: UserOrganization UserOrganization_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."UserOrganization"
    ADD CONSTRAINT "UserOrganization_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: Webhooks Webhooks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Webhooks"
    ADD CONSTRAINT "Webhooks_pkey" PRIMARY KEY (id);


--
-- Name: legacy_unmanaged_archive legacy_unmanaged_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legacy_unmanaged_archive
    ADD CONSTRAINT legacy_unmanaged_archive_pkey PRIMARY KEY (id);


--
-- Name: mastra_agent_versions mastra_agent_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_agent_versions
    ADD CONSTRAINT mastra_agent_versions_pkey PRIMARY KEY (id);


--
-- Name: mastra_agents mastra_agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_agents
    ADD CONSTRAINT mastra_agents_pkey PRIMARY KEY (id);


--
-- Name: mastra_background_tasks mastra_background_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_background_tasks
    ADD CONSTRAINT mastra_background_tasks_pkey PRIMARY KEY (id);


--
-- Name: mastra_channel_config mastra_channel_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_channel_config
    ADD CONSTRAINT mastra_channel_config_pkey PRIMARY KEY (platform);


--
-- Name: mastra_channel_installations mastra_channel_installations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_channel_installations
    ADD CONSTRAINT mastra_channel_installations_pkey PRIMARY KEY (id);


--
-- Name: mastra_dataset_items mastra_dataset_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_dataset_items
    ADD CONSTRAINT mastra_dataset_items_pkey PRIMARY KEY (id, "datasetVersion");


--
-- Name: mastra_dataset_versions mastra_dataset_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_dataset_versions
    ADD CONSTRAINT mastra_dataset_versions_pkey PRIMARY KEY (id);


--
-- Name: mastra_datasets mastra_datasets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_datasets
    ADD CONSTRAINT mastra_datasets_pkey PRIMARY KEY (id);


--
-- Name: mastra_experiment_results mastra_experiment_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_experiment_results
    ADD CONSTRAINT mastra_experiment_results_pkey PRIMARY KEY (id);


--
-- Name: mastra_experiments mastra_experiments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_experiments
    ADD CONSTRAINT mastra_experiments_pkey PRIMARY KEY (id);


--
-- Name: mastra_favorites mastra_favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_favorites
    ADD CONSTRAINT mastra_favorites_pkey PRIMARY KEY ("userId", "entityType", "entityId");


--
-- Name: mastra_knowledge_activity mastra_knowledge_activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_knowledge_activity
    ADD CONSTRAINT mastra_knowledge_activity_pkey PRIMARY KEY (id);


--
-- Name: mastra_knowledge_cursors mastra_knowledge_cursors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_knowledge_cursors
    ADD CONSTRAINT mastra_knowledge_cursors_pkey PRIMARY KEY ("sourceThreadId", agent);


--
-- Name: mastra_knowledge_mentions mastra_knowledge_mentions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_knowledge_mentions
    ADD CONSTRAINT mastra_knowledge_mentions_pkey PRIMARY KEY ("sourceType", "sourceId", "recordId");


--
-- Name: mastra_knowledge_nodes mastra_knowledge_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_knowledge_nodes
    ADD CONSTRAINT mastra_knowledge_nodes_pkey PRIMARY KEY (id);


--
-- Name: mastra_knowledge_records mastra_knowledge_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_knowledge_records
    ADD CONSTRAINT mastra_knowledge_records_pkey PRIMARY KEY (id);


--
-- Name: mastra_knowledge_semantic_outbox mastra_knowledge_semantic_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_knowledge_semantic_outbox
    ADD CONSTRAINT mastra_knowledge_semantic_outbox_pkey PRIMARY KEY (id);


--
-- Name: mastra_mcp_client_versions mastra_mcp_client_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_mcp_client_versions
    ADD CONSTRAINT mastra_mcp_client_versions_pkey PRIMARY KEY (id);


--
-- Name: mastra_mcp_clients mastra_mcp_clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_mcp_clients
    ADD CONSTRAINT mastra_mcp_clients_pkey PRIMARY KEY (id);


--
-- Name: mastra_mcp_server_versions mastra_mcp_server_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_mcp_server_versions
    ADD CONSTRAINT mastra_mcp_server_versions_pkey PRIMARY KEY (id);


--
-- Name: mastra_mcp_servers mastra_mcp_servers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_mcp_servers
    ADD CONSTRAINT mastra_mcp_servers_pkey PRIMARY KEY (id);


--
-- Name: mastra_messages mastra_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_messages
    ADD CONSTRAINT mastra_messages_pkey PRIMARY KEY (id);


--
-- Name: mastra_observational_memory mastra_observational_memory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_observational_memory
    ADD CONSTRAINT mastra_observational_memory_pkey PRIMARY KEY (id);


--
-- Name: mastra_prompt_block_versions mastra_prompt_block_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_prompt_block_versions
    ADD CONSTRAINT mastra_prompt_block_versions_pkey PRIMARY KEY (id);


--
-- Name: mastra_prompt_blocks mastra_prompt_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_prompt_blocks
    ADD CONSTRAINT mastra_prompt_blocks_pkey PRIMARY KEY (id);


--
-- Name: mastra_resources mastra_resources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_resources
    ADD CONSTRAINT mastra_resources_pkey PRIMARY KEY (id);


--
-- Name: mastra_schedule_triggers mastra_schedule_triggers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_schedule_triggers
    ADD CONSTRAINT mastra_schedule_triggers_pkey PRIMARY KEY (id);


--
-- Name: mastra_schedules mastra_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_schedules
    ADD CONSTRAINT mastra_schedules_pkey PRIMARY KEY (id);


--
-- Name: mastra_scorer_definition_versions mastra_scorer_definition_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_scorer_definition_versions
    ADD CONSTRAINT mastra_scorer_definition_versions_pkey PRIMARY KEY (id);


--
-- Name: mastra_scorer_definitions mastra_scorer_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_scorer_definitions
    ADD CONSTRAINT mastra_scorer_definitions_pkey PRIMARY KEY (id);


--
-- Name: mastra_scorers mastra_scorers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_scorers
    ADD CONSTRAINT mastra_scorers_pkey PRIMARY KEY (id);


--
-- Name: mastra_skill_blobs mastra_skill_blobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_skill_blobs
    ADD CONSTRAINT mastra_skill_blobs_pkey PRIMARY KEY (hash);


--
-- Name: mastra_skill_versions mastra_skill_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_skill_versions
    ADD CONSTRAINT mastra_skill_versions_pkey PRIMARY KEY (id);


--
-- Name: mastra_skills mastra_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_skills
    ADD CONSTRAINT mastra_skills_pkey PRIMARY KEY (id);


--
-- Name: mastra_thread_state mastra_thread_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_thread_state
    ADD CONSTRAINT mastra_thread_state_pkey PRIMARY KEY ("threadId", type);


--
-- Name: mastra_threads mastra_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_threads
    ADD CONSTRAINT mastra_threads_pkey PRIMARY KEY (id);


--
-- Name: mastra_tool_provider_connections mastra_tool_provider_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_tool_provider_connections
    ADD CONSTRAINT mastra_tool_provider_connections_pkey PRIMARY KEY ("authorId", "providerId", "connectionId");


--
-- Name: mastra_traces mastra_traces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_traces
    ADD CONSTRAINT mastra_traces_pkey PRIMARY KEY (id);


--
-- Name: mastra_workflow_definitions mastra_workflow_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_workflow_definitions
    ADD CONSTRAINT mastra_workflow_definitions_pkey PRIMARY KEY (id);


--
-- Name: mastra_workspace_versions mastra_workspace_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_workspace_versions
    ADD CONSTRAINT mastra_workspace_versions_pkey PRIMARY KEY (id);


--
-- Name: mastra_workspaces mastra_workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_workspaces
    ADD CONSTRAINT mastra_workspaces_pkey PRIMARY KEY (id);


--
-- Name: mastra_ai_spans public_mastra_ai_spans_traceid_spanid_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mastra_ai_spans
    ADD CONSTRAINT public_mastra_ai_spans_traceid_spanid_pk PRIMARY KEY ("traceId", "spanId");


--
-- Name: AutoPost_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AutoPost_deletedAt_idx" ON public."AutoPost" USING btree ("deletedAt");


--
-- Name: ClippingClip_clippingId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ClippingClip_clippingId_idx" ON public."ClippingClip" USING btree ("clippingId");


--
-- Name: Clipping_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Clipping_deletedAt_idx" ON public."Clipping" USING btree ("deletedAt");


--
-- Name: Clipping_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Clipping_organizationId_idx" ON public."Clipping" USING btree ("organizationId");


--
-- Name: Comments_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Comments_createdAt_idx" ON public."Comments" USING btree ("createdAt");


--
-- Name: Comments_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Comments_deletedAt_idx" ON public."Comments" USING btree ("deletedAt");


--
-- Name: Comments_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Comments_organizationId_idx" ON public."Comments" USING btree ("organizationId");


--
-- Name: Comments_parentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Comments_parentId_idx" ON public."Comments" USING btree ("parentId");


--
-- Name: Comments_postId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Comments_postId_idx" ON public."Comments" USING btree ("postId");


--
-- Name: Comments_resolvedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Comments_resolvedAt_idx" ON public."Comments" USING btree ("resolvedAt");


--
-- Name: Comments_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Comments_userId_idx" ON public."Comments" USING btree ("userId");


--
-- Name: Credits_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Credits_createdAt_idx" ON public."Credits" USING btree ("createdAt");


--
-- Name: Credits_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Credits_organizationId_idx" ON public."Credits" USING btree ("organizationId");


--
-- Name: Customer_orgId_name_deletedAt_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Customer_orgId_name_deletedAt_key" ON public."Customer" USING btree ("orgId", name, "deletedAt");


--
-- Name: Errors_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Errors_createdAt_idx" ON public."Errors" USING btree ("createdAt");


--
-- Name: Errors_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Errors_organizationId_idx" ON public."Errors" USING btree ("organizationId");


--
-- Name: ExisingPlugData_integrationId_methodName_value_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ExisingPlugData_integrationId_methodName_value_key" ON public."ExisingPlugData" USING btree ("integrationId", "methodName", value);


--
-- Name: GitHub_login_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "GitHub_login_idx" ON public."GitHub" USING btree (login);


--
-- Name: GitHub_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "GitHub_organizationId_idx" ON public."GitHub" USING btree ("organizationId");


--
-- Name: Integration_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Integration_createdAt_idx" ON public."Integration" USING btree ("createdAt");


--
-- Name: Integration_customerId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Integration_customerId_idx" ON public."Integration" USING btree ("customerId");


--
-- Name: Integration_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Integration_deletedAt_idx" ON public."Integration" USING btree ("deletedAt");


--
-- Name: Integration_disabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Integration_disabled_idx" ON public."Integration" USING btree (disabled);


--
-- Name: Integration_inBetweenSteps_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Integration_inBetweenSteps_idx" ON public."Integration" USING btree ("inBetweenSteps");


--
-- Name: Integration_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Integration_organizationId_idx" ON public."Integration" USING btree ("organizationId");


--
-- Name: Integration_organizationId_internalId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Integration_organizationId_internalId_key" ON public."Integration" USING btree ("organizationId", "internalId");


--
-- Name: Integration_providerIdentifier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Integration_providerIdentifier_idx" ON public."Integration" USING btree ("providerIdentifier");


--
-- Name: Integration_refreshNeeded_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Integration_refreshNeeded_idx" ON public."Integration" USING btree ("refreshNeeded");


--
-- Name: Integration_rootInternalId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Integration_rootInternalId_idx" ON public."Integration" USING btree ("rootInternalId");


--
-- Name: Integration_updatedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Integration_updatedAt_idx" ON public."Integration" USING btree ("updatedAt");


--
-- Name: IntegrationsWebhooks_integrationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IntegrationsWebhooks_integrationId_idx" ON public."IntegrationsWebhooks" USING btree ("integrationId");


--
-- Name: IntegrationsWebhooks_integrationId_webhookId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "IntegrationsWebhooks_integrationId_webhookId_key" ON public."IntegrationsWebhooks" USING btree ("integrationId", "webhookId");


--
-- Name: IntegrationsWebhooks_webhookId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IntegrationsWebhooks_webhookId_idx" ON public."IntegrationsWebhooks" USING btree ("webhookId");


--
-- Name: ItemUser_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ItemUser_key_idx" ON public."ItemUser" USING btree (key);


--
-- Name: ItemUser_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ItemUser_userId_idx" ON public."ItemUser" USING btree ("userId");


--
-- Name: ItemUser_userId_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ItemUser_userId_key_key" ON public."ItemUser" USING btree ("userId", key);


--
-- Name: Media_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Media_name_idx" ON public."Media" USING btree (name);


--
-- Name: Media_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Media_organizationId_idx" ON public."Media" USING btree ("organizationId");


--
-- Name: Media_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Media_type_idx" ON public."Media" USING btree (type);


--
-- Name: Mentions_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Mentions_createdAt_idx" ON public."Mentions" USING btree ("createdAt");


--
-- Name: MessagesGroup_buyerId_sellerId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "MessagesGroup_buyerId_sellerId_key" ON public."MessagesGroup" USING btree ("buyerId", "sellerId");


--
-- Name: MessagesGroup_buyerOrganizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "MessagesGroup_buyerOrganizationId_idx" ON public."MessagesGroup" USING btree ("buyerOrganizationId");


--
-- Name: MessagesGroup_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "MessagesGroup_createdAt_idx" ON public."MessagesGroup" USING btree ("createdAt");


--
-- Name: MessagesGroup_updatedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "MessagesGroup_updatedAt_idx" ON public."MessagesGroup" USING btree ("updatedAt");


--
-- Name: Messages_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Messages_createdAt_idx" ON public."Messages" USING btree ("createdAt");


--
-- Name: Messages_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Messages_deletedAt_idx" ON public."Messages" USING btree ("deletedAt");


--
-- Name: Messages_groupId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Messages_groupId_idx" ON public."Messages" USING btree ("groupId");


--
-- Name: Notifications_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Notifications_createdAt_idx" ON public."Notifications" USING btree ("createdAt");


--
-- Name: Notifications_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Notifications_deletedAt_idx" ON public."Notifications" USING btree ("deletedAt");


--
-- Name: Notifications_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Notifications_organizationId_idx" ON public."Notifications" USING btree ("organizationId");


--
-- Name: OAuthApp_clientId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OAuthApp_clientId_idx" ON public."OAuthApp" USING btree ("clientId");


--
-- Name: OAuthApp_clientId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "OAuthApp_clientId_key" ON public."OAuthApp" USING btree ("clientId");


--
-- Name: OAuthApp_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OAuthApp_deletedAt_idx" ON public."OAuthApp" USING btree ("deletedAt");


--
-- Name: OAuthApp_dynamic_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OAuthApp_dynamic_idx" ON public."OAuthApp" USING btree (dynamic);


--
-- Name: OAuthApp_organizationId_deletedAt_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "OAuthApp_organizationId_deletedAt_key" ON public."OAuthApp" USING btree ("organizationId", "deletedAt");


--
-- Name: OAuthApp_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OAuthApp_organizationId_idx" ON public."OAuthApp" USING btree ("organizationId");


--
-- Name: OAuthAuthorization_accessToken_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OAuthAuthorization_accessToken_idx" ON public."OAuthAuthorization" USING btree ("accessToken");


--
-- Name: OAuthAuthorization_authorizationCode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OAuthAuthorization_authorizationCode_idx" ON public."OAuthAuthorization" USING btree ("authorizationCode");


--
-- Name: OAuthAuthorization_oauthAppId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OAuthAuthorization_oauthAppId_idx" ON public."OAuthAuthorization" USING btree ("oauthAppId");


--
-- Name: OAuthAuthorization_oauthAppId_userId_organizationId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "OAuthAuthorization_oauthAppId_userId_organizationId_key" ON public."OAuthAuthorization" USING btree ("oauthAppId", "userId", "organizationId");


--
-- Name: OAuthAuthorization_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OAuthAuthorization_organizationId_idx" ON public."OAuthAuthorization" USING btree ("organizationId");


--
-- Name: OAuthAuthorization_revokedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OAuthAuthorization_revokedAt_idx" ON public."OAuthAuthorization" USING btree ("revokedAt");


--
-- Name: OAuthAuthorization_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OAuthAuthorization_userId_idx" ON public."OAuthAuthorization" USING btree ("userId");


--
-- Name: OAuthSelfHostedAuthorization_accessToken_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OAuthSelfHostedAuthorization_accessToken_idx" ON public."OAuthSelfHostedAuthorization" USING btree ("accessToken");


--
-- Name: OAuthSelfHostedAuthorization_authorizationCode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OAuthSelfHostedAuthorization_authorizationCode_idx" ON public."OAuthSelfHostedAuthorization" USING btree ("authorizationCode");


--
-- Name: OAuthSelfHostedAuthorization_oauthAppId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OAuthSelfHostedAuthorization_oauthAppId_idx" ON public."OAuthSelfHostedAuthorization" USING btree ("oauthAppId");


--
-- Name: OrderItems_integrationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OrderItems_integrationId_idx" ON public."OrderItems" USING btree ("integrationId");


--
-- Name: OrderItems_orderId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OrderItems_orderId_idx" ON public."OrderItems" USING btree ("orderId");


--
-- Name: Orders_buyerId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Orders_buyerId_idx" ON public."Orders" USING btree ("buyerId");


--
-- Name: Orders_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Orders_createdAt_idx" ON public."Orders" USING btree ("createdAt");


--
-- Name: Orders_messageGroupId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Orders_messageGroupId_idx" ON public."Orders" USING btree ("messageGroupId");


--
-- Name: Orders_sellerId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Orders_sellerId_idx" ON public."Orders" USING btree ("sellerId");


--
-- Name: Orders_updatedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Orders_updatedAt_idx" ON public."Orders" USING btree ("updatedAt");


--
-- Name: Organization_apiKey_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Organization_apiKey_idx" ON public."Organization" USING btree ("apiKey");


--
-- Name: Organization_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Organization_deletedAt_idx" ON public."Organization" USING btree ("deletedAt");


--
-- Name: Organization_paymentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Organization_paymentId_idx" ON public."Organization" USING btree ("paymentId");


--
-- Name: Organization_streakSince_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Organization_streakSince_idx" ON public."Organization" USING btree ("streakSince");


--
-- Name: Plugs_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Plugs_organizationId_idx" ON public."Plugs" USING btree ("organizationId");


--
-- Name: Plugs_plugFunction_integrationId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Plugs_plugFunction_integrationId_key" ON public."Plugs" USING btree ("plugFunction", "integrationId");


--
-- Name: Post_approvedSubmitForOrder_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Post_approvedSubmitForOrder_idx" ON public."Post" USING btree ("approvedSubmitForOrder");


--
-- Name: Post_batchId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Post_batchId_idx" ON public."Post" USING btree ("batchId");


--
-- Name: Post_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Post_createdAt_idx" ON public."Post" USING btree ("createdAt");


--
-- Name: Post_creationMethod_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Post_creationMethod_idx" ON public."Post" USING btree ("creationMethod");


--
-- Name: Post_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Post_deletedAt_idx" ON public."Post" USING btree ("deletedAt");


--
-- Name: Post_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Post_group_idx" ON public."Post" USING btree ("group");


--
-- Name: Post_integrationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Post_integrationId_idx" ON public."Post" USING btree ("integrationId");


--
-- Name: Post_intervalInDays_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Post_intervalInDays_idx" ON public."Post" USING btree ("intervalInDays");


--
-- Name: Post_lastMessageId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Post_lastMessageId_idx" ON public."Post" USING btree ("lastMessageId");


--
-- Name: Post_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Post_organizationId_idx" ON public."Post" USING btree ("organizationId");


--
-- Name: Post_parentPostId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Post_parentPostId_idx" ON public."Post" USING btree ("parentPostId");


--
-- Name: Post_publishDate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Post_publishDate_idx" ON public."Post" USING btree ("publishDate");


--
-- Name: Post_releaseURL_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Post_releaseURL_idx" ON public."Post" USING btree ("releaseURL");


--
-- Name: Post_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Post_state_idx" ON public."Post" USING btree (state);


--
-- Name: Post_submittedForOrderId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Post_submittedForOrderId_idx" ON public."Post" USING btree ("submittedForOrderId");


--
-- Name: Post_updatedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Post_updatedAt_idx" ON public."Post" USING btree ("updatedAt");


--
-- Name: Sets_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Sets_organizationId_idx" ON public."Sets" USING btree ("organizationId");


--
-- Name: Signatures_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Signatures_createdAt_idx" ON public."Signatures" USING btree ("createdAt");


--
-- Name: Signatures_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Signatures_deletedAt_idx" ON public."Signatures" USING btree ("deletedAt");


--
-- Name: Signatures_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Signatures_organizationId_idx" ON public."Signatures" USING btree ("organizationId");


--
-- Name: SocialMediaAgency_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SocialMediaAgency_deletedAt_idx" ON public."SocialMediaAgency" USING btree ("deletedAt");


--
-- Name: SocialMediaAgency_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SocialMediaAgency_id_idx" ON public."SocialMediaAgency" USING btree (id);


--
-- Name: SocialMediaAgency_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SocialMediaAgency_userId_idx" ON public."SocialMediaAgency" USING btree ("userId");


--
-- Name: SocialMediaAgency_userId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SocialMediaAgency_userId_key" ON public."SocialMediaAgency" USING btree ("userId");


--
-- Name: Star_login_date_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Star_login_date_key" ON public."Star" USING btree (login, date);


--
-- Name: Subscription_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Subscription_deletedAt_idx" ON public."Subscription" USING btree ("deletedAt");


--
-- Name: Subscription_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Subscription_organizationId_idx" ON public."Subscription" USING btree ("organizationId");


--
-- Name: Subscription_organizationId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Subscription_organizationId_key" ON public."Subscription" USING btree ("organizationId");


--
-- Name: TagsPosts_postId_tagId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "TagsPosts_postId_tagId_key" ON public."TagsPosts" USING btree ("postId", "tagId");


--
-- Name: Tags_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Tags_deletedAt_idx" ON public."Tags" USING btree ("deletedAt");


--
-- Name: Tags_orgId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Tags_orgId_idx" ON public."Tags" USING btree ("orgId");


--
-- Name: ThirdParty_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ThirdParty_deletedAt_idx" ON public."ThirdParty" USING btree ("deletedAt");


--
-- Name: ThirdParty_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ThirdParty_organizationId_idx" ON public."ThirdParty" USING btree ("organizationId");


--
-- Name: ThirdParty_organizationId_internalId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ThirdParty_organizationId_internalId_key" ON public."ThirdParty" USING btree ("organizationId", "internalId");


--
-- Name: Trending_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Trending_hash_idx" ON public."Trending" USING btree (hash);


--
-- Name: Trending_language_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Trending_language_key" ON public."Trending" USING btree (language);


--
-- Name: UsedCodes_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "UsedCodes_code_idx" ON public."UsedCodes" USING btree (code);


--
-- Name: UserOrganization_disabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "UserOrganization_disabled_idx" ON public."UserOrganization" USING btree (disabled);


--
-- Name: UserOrganization_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "UserOrganization_organizationId_idx" ON public."UserOrganization" USING btree ("organizationId");


--
-- Name: UserOrganization_userId_organizationId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "UserOrganization_userId_organizationId_key" ON public."UserOrganization" USING btree ("userId", "organizationId");


--
-- Name: User_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "User_account_idx" ON public."User" USING btree (account);


--
-- Name: User_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "User_deletedAt_idx" ON public."User" USING btree ("deletedAt");


--
-- Name: User_email_providerName_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "User_email_providerName_key" ON public."User" USING btree (email, "providerName");


--
-- Name: User_inviteId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "User_inviteId_idx" ON public."User" USING btree ("inviteId");


--
-- Name: User_lastOnline_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "User_lastOnline_idx" ON public."User" USING btree ("lastOnline");


--
-- Name: User_lastReadNotifications_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "User_lastReadNotifications_idx" ON public."User" USING btree ("lastReadNotifications");


--
-- Name: User_pictureId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "User_pictureId_idx" ON public."User" USING btree ("pictureId");


--
-- Name: Webhooks_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Webhooks_deletedAt_idx" ON public."Webhooks" USING btree ("deletedAt");


--
-- Name: Webhooks_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Webhooks_organizationId_idx" ON public."Webhooks" USING btree ("organizationId");


--
-- Name: idx_channel_installations_platform_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_channel_installations_platform_agent ON public.mastra_channel_installations USING btree (platform, "agentId");


--
-- Name: idx_channel_installations_webhook; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_channel_installations_webhook ON public.mastra_channel_installations USING btree ("webhookId");


--
-- Name: idx_dataset_items_dataset_validto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dataset_items_dataset_validto ON public.mastra_dataset_items USING btree ("datasetId", "validTo");


--
-- Name: idx_dataset_items_dataset_validto_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dataset_items_dataset_validto_deleted ON public.mastra_dataset_items USING btree ("datasetId", "validTo", "isDeleted");


--
-- Name: idx_dataset_items_dataset_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dataset_items_dataset_version ON public.mastra_dataset_items USING btree ("datasetId", "datasetVersion");


--
-- Name: idx_dataset_items_external_id_history; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dataset_items_external_id_history ON public.mastra_dataset_items USING btree ("datasetId", "externalId", "datasetVersion");


--
-- Name: idx_dataset_items_org_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dataset_items_org_project ON public.mastra_dataset_items USING btree ("organizationId", "projectId");


--
-- Name: idx_dataset_versions_dataset_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dataset_versions_dataset_version ON public.mastra_dataset_versions USING btree ("datasetId", version);


--
-- Name: idx_dataset_versions_dataset_version_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_dataset_versions_dataset_version_unique ON public.mastra_dataset_versions USING btree ("datasetId", version);


--
-- Name: idx_datasets_candidate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_datasets_candidate ON public.mastra_datasets USING btree ("candidateKey", "candidateId");


--
-- Name: idx_datasets_org_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_datasets_org_project ON public.mastra_datasets USING btree ("organizationId", "projectId");


--
-- Name: idx_experiment_results_exp_item_attempt; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_experiment_results_exp_item_attempt ON public.mastra_experiment_results USING btree ("experimentId", "itemId", attempt);


--
-- Name: idx_experiment_results_experimentid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_experiment_results_experimentid ON public.mastra_experiment_results USING btree ("experimentId");


--
-- Name: idx_experiment_results_org_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_experiment_results_org_project ON public.mastra_experiment_results USING btree ("organizationId", "projectId");


--
-- Name: idx_experiment_results_tags_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_experiment_results_tags_gin ON public.mastra_experiment_results USING gin (tags);


--
-- Name: idx_experiments_datasetid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_experiments_datasetid ON public.mastra_experiments USING btree ("datasetId");


--
-- Name: idx_experiments_grouping; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_experiments_grouping ON public.mastra_experiments USING btree ("experimentSetId", "comparisonId", "variantId", "trialIndex");


--
-- Name: idx_experiments_org_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_experiments_org_project ON public.mastra_experiments USING btree ("organizationId", "projectId");


--
-- Name: idx_favorites_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_favorites_entity ON public.mastra_favorites USING btree ("entityType", "entityId");


--
-- Name: idx_knowledge_activity_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_activity_latest ON public.mastra_knowledge_activity USING btree (id DESC);


--
-- Name: idx_knowledge_mentions_record; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_mentions_record ON public.mastra_knowledge_mentions USING btree ("recordId", "sourceType", "sourceId");


--
-- Name: idx_knowledge_nodes_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_knowledge_nodes_identity ON public.mastra_knowledge_nodes USING btree (type, "scopeKey", "canonicalName");


--
-- Name: idx_knowledge_nodes_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_nodes_scope ON public.mastra_knowledge_nodes USING btree ("scopeKey", type);


--
-- Name: idx_knowledge_outbox_claim; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_outbox_claim ON public.mastra_knowledge_semantic_outbox USING btree (status, "availableAt", "createdAt");


--
-- Name: idx_knowledge_outbox_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_knowledge_outbox_idempotency ON public.mastra_knowledge_semantic_outbox USING btree ("idempotencyKey");


--
-- Name: idx_knowledge_records_node_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_records_node_latest ON public.mastra_knowledge_records USING btree (node, id DESC);


--
-- Name: idx_knowledge_records_thread_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_records_thread_latest ON public.mastra_knowledge_records USING btree ("sourceThreadId", id DESC);


--
-- Name: idx_mastra_schedule_triggers_schedule_fire; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mastra_schedule_triggers_schedule_fire ON public.mastra_schedule_triggers USING btree (schedule_id, actual_fire_at DESC);


--
-- Name: idx_mastra_schedules_status_next_fire; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mastra_schedules_status_next_fire ON public.mastra_schedules USING btree (status, next_fire_at);


--
-- Name: idx_mcp_client_versions_client_version; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mcp_client_versions_client_version ON public.mastra_mcp_client_versions USING btree ("mcpClientId", "versionNumber");


--
-- Name: idx_mcp_server_versions_server_version; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mcp_server_versions_server_version ON public.mastra_mcp_server_versions USING btree ("mcpServerId", "versionNumber");


--
-- Name: idx_notifications_coalescing; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_coalescing ON public.mastra_notifications USING btree ("threadId", source, kind, status, "agentId", "resourceId", "dedupeKey", "coalesceKey");


--
-- Name: idx_notifications_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_due ON public.mastra_notifications USING btree (status, "deliverAt", "summaryAt");


--
-- Name: idx_notifications_thread_status_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_thread_status_updated ON public.mastra_notifications USING btree ("threadId", status, "updatedAt");


--
-- Name: idx_om_lookup_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_om_lookup_key ON public.mastra_observational_memory USING btree ("lookupKey");


--
-- Name: idx_prompt_block_versions_block_version; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_prompt_block_versions_block_version ON public.mastra_prompt_block_versions USING btree ("blockId", "versionNumber");


--
-- Name: idx_scorer_definition_versions_def_version; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_scorer_definition_versions_def_version ON public.mastra_scorer_definition_versions USING btree ("scorerDefinitionId", "versionNumber");


--
-- Name: idx_skill_versions_skill_version; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_skill_versions_skill_version ON public.mastra_skill_versions USING btree ("skillId", "versionNumber");


--
-- Name: idx_tool_provider_connections_author; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tool_provider_connections_author ON public.mastra_tool_provider_connections USING btree ("authorId", "providerId", toolkit);


--
-- Name: idx_workflow_definitions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_definitions_status ON public.mastra_workflow_definitions USING btree (status);


--
-- Name: idx_workspace_versions_workspace_version; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_workspace_versions_workspace_version ON public.mastra_workspace_versions USING btree ("workspaceId", "versionNumber");


--
-- Name: mastra_ai_spans_entitytype_entityid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mastra_ai_spans_entitytype_entityid_idx ON public.mastra_ai_spans USING btree ("entityType", "entityId");


--
-- Name: mastra_ai_spans_entitytype_entityname_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mastra_ai_spans_entitytype_entityname_idx ON public.mastra_ai_spans USING btree ("entityType", "entityName");


--
-- Name: mastra_ai_spans_metadata_gin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mastra_ai_spans_metadata_gin_idx ON public.mastra_ai_spans USING gin (metadata);


--
-- Name: mastra_ai_spans_orgid_userid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mastra_ai_spans_orgid_userid_idx ON public.mastra_ai_spans USING btree ("organizationId", "userId");


--
-- Name: mastra_ai_spans_tags_gin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mastra_ai_spans_tags_gin_idx ON public.mastra_ai_spans USING gin (tags);


--
-- Name: mastra_bg_tasks_agent_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mastra_bg_tasks_agent_status_idx ON public.mastra_background_tasks USING btree (agent_id, status);


--
-- Name: mastra_bg_tasks_status_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mastra_bg_tasks_status_created_at_idx ON public.mastra_background_tasks USING btree (status, "createdAt");


--
-- Name: mastra_bg_tasks_thread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mastra_bg_tasks_thread_idx ON public.mastra_background_tasks USING btree (thread_id, "createdAt");


--
-- Name: mastra_bg_tasks_tool_call_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mastra_bg_tasks_tool_call_idx ON public.mastra_background_tasks USING btree (tool_call_id);


--
-- Name: mastra_workflow_snapshot_name_createdat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mastra_workflow_snapshot_name_createdat_idx ON public.mastra_workflow_snapshot USING btree (workflow_name, "createdAt" DESC);


--
-- Name: public_mastra_ai_spans_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX public_mastra_ai_spans_name_idx ON public.mastra_ai_spans USING btree (name);


--
-- Name: public_mastra_ai_spans_parentspanid_startedat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX public_mastra_ai_spans_parentspanid_startedat_idx ON public.mastra_ai_spans USING btree ("parentSpanId", "startedAt" DESC);


--
-- Name: public_mastra_ai_spans_spantype_startedat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX public_mastra_ai_spans_spantype_startedat_idx ON public.mastra_ai_spans USING btree ("spanType", "startedAt" DESC);


--
-- Name: public_mastra_ai_spans_traceid_startedat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX public_mastra_ai_spans_traceid_startedat_idx ON public.mastra_ai_spans USING btree ("traceId", "startedAt" DESC);


--
-- Name: public_mastra_evals_agent_name_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX public_mastra_evals_agent_name_created_at_idx ON public.mastra_evals USING btree (agent_name, created_at DESC);


--
-- Name: public_mastra_messages_thread_id_createdat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX public_mastra_messages_thread_id_createdat_idx ON public.mastra_messages USING btree (thread_id, "createdAt" DESC);


--
-- Name: public_mastra_scores_trace_id_span_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX public_mastra_scores_trace_id_span_id_created_at_idx ON public.mastra_scorers USING btree ("traceId", "spanId", "createdAt" DESC);


--
-- Name: public_mastra_threads_resourceid_createdat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX public_mastra_threads_resourceid_createdat_idx ON public.mastra_threads USING btree ("resourceId", "createdAt" DESC);


--
-- Name: public_mastra_traces_name_starttime_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX public_mastra_traces_name_starttime_idx ON public.mastra_traces USING btree (name, "startTime" DESC);


--
-- Name: public_mastra_workflow_snapshot_workflow_name_run_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX public_mastra_workflow_snapshot_workflow_name_run_id_key ON public.mastra_workflow_snapshot USING btree (workflow_name, run_id);


--
-- Name: AutoPost AutoPost_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AutoPost"
    ADD CONSTRAINT "AutoPost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ClippingClip ClippingClip_clippingId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ClippingClip"
    ADD CONSTRAINT "ClippingClip_clippingId_fkey" FOREIGN KEY ("clippingId") REFERENCES public."Clipping"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Clipping Clipping_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Clipping"
    ADD CONSTRAINT "Clipping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Comments Comments_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Comments"
    ADD CONSTRAINT "Comments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Comments Comments_parentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Comments"
    ADD CONSTRAINT "Comments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES public."Comments"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Comments Comments_postId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Comments"
    ADD CONSTRAINT "Comments_postId_fkey" FOREIGN KEY ("postId") REFERENCES public."Post"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Comments Comments_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Comments"
    ADD CONSTRAINT "Comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Credits Credits_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Credits"
    ADD CONSTRAINT "Credits_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Customer Customer_orgId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Customer"
    ADD CONSTRAINT "Customer_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Errors Errors_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Errors"
    ADD CONSTRAINT "Errors_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Errors Errors_postId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Errors"
    ADD CONSTRAINT "Errors_postId_fkey" FOREIGN KEY ("postId") REFERENCES public."Post"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ExisingPlugData ExisingPlugData_integrationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ExisingPlugData"
    ADD CONSTRAINT "ExisingPlugData_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES public."Integration"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: GitHub GitHub_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."GitHub"
    ADD CONSTRAINT "GitHub_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Integration Integration_customerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Integration"
    ADD CONSTRAINT "Integration_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES public."Customer"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Integration Integration_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Integration"
    ADD CONSTRAINT "Integration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: IntegrationsWebhooks IntegrationsWebhooks_integrationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."IntegrationsWebhooks"
    ADD CONSTRAINT "IntegrationsWebhooks_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES public."Integration"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: IntegrationsWebhooks IntegrationsWebhooks_webhookId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."IntegrationsWebhooks"
    ADD CONSTRAINT "IntegrationsWebhooks_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES public."Webhooks"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ItemUser ItemUser_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ItemUser"
    ADD CONSTRAINT "ItemUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Media Media_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Media"
    ADD CONSTRAINT "Media_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: MessagesGroup MessagesGroup_buyerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MessagesGroup"
    ADD CONSTRAINT "MessagesGroup_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: MessagesGroup MessagesGroup_buyerOrganizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MessagesGroup"
    ADD CONSTRAINT "MessagesGroup_buyerOrganizationId_fkey" FOREIGN KEY ("buyerOrganizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: MessagesGroup MessagesGroup_sellerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MessagesGroup"
    ADD CONSTRAINT "MessagesGroup_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Messages Messages_groupId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Messages"
    ADD CONSTRAINT "Messages_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES public."MessagesGroup"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Notifications Notifications_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Notifications"
    ADD CONSTRAINT "Notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: OAuthApp OAuthApp_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OAuthApp"
    ADD CONSTRAINT "OAuthApp_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: OAuthApp OAuthApp_pictureId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OAuthApp"
    ADD CONSTRAINT "OAuthApp_pictureId_fkey" FOREIGN KEY ("pictureId") REFERENCES public."Media"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: OAuthAuthorization OAuthAuthorization_oauthAppId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OAuthAuthorization"
    ADD CONSTRAINT "OAuthAuthorization_oauthAppId_fkey" FOREIGN KEY ("oauthAppId") REFERENCES public."OAuthApp"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: OAuthAuthorization OAuthAuthorization_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OAuthAuthorization"
    ADD CONSTRAINT "OAuthAuthorization_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: OAuthAuthorization OAuthAuthorization_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OAuthAuthorization"
    ADD CONSTRAINT "OAuthAuthorization_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: OAuthSelfHostedAuthorization OAuthSelfHostedAuthorization_oauthAppId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OAuthSelfHostedAuthorization"
    ADD CONSTRAINT "OAuthSelfHostedAuthorization_oauthAppId_fkey" FOREIGN KEY ("oauthAppId") REFERENCES public."OAuthApp"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: OrderItems OrderItems_integrationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OrderItems"
    ADD CONSTRAINT "OrderItems_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES public."Integration"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: OrderItems OrderItems_orderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OrderItems"
    ADD CONSTRAINT "OrderItems_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES public."Orders"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Orders Orders_buyerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Orders"
    ADD CONSTRAINT "Orders_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Orders Orders_messageGroupId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Orders"
    ADD CONSTRAINT "Orders_messageGroupId_fkey" FOREIGN KEY ("messageGroupId") REFERENCES public."MessagesGroup"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Orders Orders_sellerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Orders"
    ADD CONSTRAINT "Orders_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PayoutProblems PayoutProblems_orderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PayoutProblems"
    ADD CONSTRAINT "PayoutProblems_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES public."Orders"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PayoutProblems PayoutProblems_postId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PayoutProblems"
    ADD CONSTRAINT "PayoutProblems_postId_fkey" FOREIGN KEY ("postId") REFERENCES public."Post"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: PayoutProblems PayoutProblems_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PayoutProblems"
    ADD CONSTRAINT "PayoutProblems_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Plugs Plugs_integrationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Plugs"
    ADD CONSTRAINT "Plugs_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES public."Integration"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Plugs Plugs_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Plugs"
    ADD CONSTRAINT "Plugs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Post Post_integrationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Post"
    ADD CONSTRAINT "Post_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES public."Integration"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Post Post_lastMessageId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Post"
    ADD CONSTRAINT "Post_lastMessageId_fkey" FOREIGN KEY ("lastMessageId") REFERENCES public."Messages"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Post Post_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Post"
    ADD CONSTRAINT "Post_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Post Post_parentPostId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Post"
    ADD CONSTRAINT "Post_parentPostId_fkey" FOREIGN KEY ("parentPostId") REFERENCES public."Post"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Post Post_submittedForOrderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Post"
    ADD CONSTRAINT "Post_submittedForOrderId_fkey" FOREIGN KEY ("submittedForOrderId") REFERENCES public."Orders"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Post Post_submittedForOrganizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Post"
    ADD CONSTRAINT "Post_submittedForOrganizationId_fkey" FOREIGN KEY ("submittedForOrganizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Sets Sets_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Sets"
    ADD CONSTRAINT "Sets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Signatures Signatures_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Signatures"
    ADD CONSTRAINT "Signatures_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SocialMediaAgencyNiche SocialMediaAgencyNiche_agencyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SocialMediaAgencyNiche"
    ADD CONSTRAINT "SocialMediaAgencyNiche_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES public."SocialMediaAgency"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SocialMediaAgency SocialMediaAgency_logoId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SocialMediaAgency"
    ADD CONSTRAINT "SocialMediaAgency_logoId_fkey" FOREIGN KEY ("logoId") REFERENCES public."Media"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: SocialMediaAgency SocialMediaAgency_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SocialMediaAgency"
    ADD CONSTRAINT "SocialMediaAgency_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Subscription Subscription_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Subscription"
    ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: TagsPosts TagsPosts_postId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TagsPosts"
    ADD CONSTRAINT "TagsPosts_postId_fkey" FOREIGN KEY ("postId") REFERENCES public."Post"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: TagsPosts TagsPosts_tagId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TagsPosts"
    ADD CONSTRAINT "TagsPosts_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES public."Tags"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Tags Tags_orgId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Tags"
    ADD CONSTRAINT "Tags_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ThirdParty ThirdParty_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ThirdParty"
    ADD CONSTRAINT "ThirdParty_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: UsedCodes UsedCodes_orgId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."UsedCodes"
    ADD CONSTRAINT "UsedCodes_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: UserOrganization UserOrganization_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."UserOrganization"
    ADD CONSTRAINT "UserOrganization_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: UserOrganization UserOrganization_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."UserOrganization"
    ADD CONSTRAINT "UserOrganization_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: User User_pictureId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pictureId_fkey" FOREIGN KEY ("pictureId") REFERENCES public."Media"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Webhooks Webhooks_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Webhooks"
    ADD CONSTRAINT "Webhooks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--


