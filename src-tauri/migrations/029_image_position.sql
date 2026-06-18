-- T72 / T74: workspace image drag-to-replace and reposition state.
ALTER TABLE workspaces ADD COLUMN profile_image_x REAL NOT NULL DEFAULT 0.5;
ALTER TABLE workspaces ADD COLUMN profile_image_y REAL NOT NULL DEFAULT 0.5;
ALTER TABLE workspaces ADD COLUMN profile_image_zoom REAL NOT NULL DEFAULT 1.0;
ALTER TABLE workspaces ADD COLUMN cover_image_x REAL NOT NULL DEFAULT 0.5;
ALTER TABLE workspaces ADD COLUMN cover_image_y REAL NOT NULL DEFAULT 0.5;
