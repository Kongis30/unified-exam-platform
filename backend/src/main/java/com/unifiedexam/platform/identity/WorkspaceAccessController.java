package com.unifiedexam.platform.identity;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 管理员按统一账号查看和调整工作区授权。 */
@RestController
@RequestMapping("/api/admin/users/{userId}/workspaces")
public class WorkspaceAccessController {
    private final WorkspaceAccessService accessService;

    public WorkspaceAccessController(WorkspaceAccessService accessService) {
        this.accessService = accessService;
    }

    @GetMapping
    public List<String> list(@PathVariable long userId) {
        return accessService.accessForUser(userId);
    }

    @PutMapping
    public void update(@PathVariable long userId, @Valid @RequestBody AccessRequest request,
                       Authentication authentication) {
        accessService.replaceAccess(userId, request.workspaceCodes(), authentication.getName());
    }

    public record AccessRequest(@NotNull List<String> workspaceCodes) { }
}
