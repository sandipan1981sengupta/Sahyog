/* =====================================================================
   ShankhNaad round 47 (safe to run more than once; needs 26_MessageReactions.sql):
     Reactions with any emoji (the new emoji panel has all of them).
       - sahyog_MessageReactions.Emoji compares exactly (binary). With the database's normal text rules many
         emoji count as "the same" (e.g. 😀 and 🚀), so reacting with one could take back another.
     Nothing is removed; existing reactions stay.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.sahyog_MessageReactions', N'U') IS NOT NULL
   AND EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id = OBJECT_ID(N'dbo.sahyog_MessageReactions') AND name = N'Emoji'
                 AND ISNULL(collation_name, N'') <> N'Latin1_General_100_BIN2')
BEGIN
    BEGIN TRANSACTION;
    IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = N'PK_sahyog_MessageReactions' AND parent_object_id = OBJECT_ID(N'dbo.sahyog_MessageReactions'))
        ALTER TABLE dbo.sahyog_MessageReactions DROP CONSTRAINT PK_sahyog_MessageReactions;
    ALTER TABLE dbo.sahyog_MessageReactions ALTER COLUMN Emoji NVARCHAR(16) COLLATE Latin1_General_100_BIN2 NOT NULL;
    ALTER TABLE dbo.sahyog_MessageReactions ADD CONSTRAINT PK_sahyog_MessageReactions PRIMARY KEY (MessageId, UserId, Emoji);
    COMMIT;
END
GO

PRINT N'38_EmojiReactionsAnyEmoji.sql applied.';
GO
