-- The library admin can remove a library item (e.g. a bad import); its change log goes with it.
CREATE POLICY library_delete ON "LibraryItem" FOR DELETE USING (current_setting('app.library_admin', true) = 'on');
CREATE POLICY library_delete ON "LibraryChange" FOR DELETE USING (current_setting('app.library_admin', true) = 'on');
