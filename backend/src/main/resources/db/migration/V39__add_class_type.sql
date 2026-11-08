ALTER TABLE classes
    ADD COLUMN class_type VARCHAR(20) NOT NULL DEFAULT 'STANDARD' AFTER description,
    ADD CONSTRAINT ck_classes_class_type CHECK (class_type IN ('STANDARD', 'INDIVIDUAL'));
