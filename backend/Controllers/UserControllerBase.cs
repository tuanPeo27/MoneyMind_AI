using backend.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers;

/// <summary>Base for endpoints that require a signed-in user and act on that user's data.</summary>
[ApiController]
[Authorize]
public abstract class UserControllerBase(ICurrentUserService currentUser) : ControllerBase
{
    protected Guid UserId => currentUser.RequiredUserId;
}
