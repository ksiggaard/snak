-- T63: workspace profile and cover images.
ALTER TABLE workspaces ADD COLUMN profile_image TEXT;
ALTER TABLE workspaces ADD COLUMN cover_image TEXT;
